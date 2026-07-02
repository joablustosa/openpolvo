/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { isLinux, isMacintosh, isWindows } from '../../../../base/common/platform.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IRequestService, asJson, NO_FETCH_TELEMETRY } from '../../../../platform/request/common/request.js';

interface IOllamaTag {
	readonly name?: string;
	readonly model?: string;
}

interface IOllamaTagsResponse {
	readonly models?: IOllamaTag[];
}

interface IOllamaVersionResponse {
	readonly version?: string;
}

export interface IOllamaHealthStatus {
	readonly running: boolean;
	readonly models: string[];
	readonly version?: string;
	readonly hasRequiredModel: boolean;
	readonly ready: boolean;
}

export interface IOllamaProbeResult {
	/** O servidor Ollama respondeu em `${url}/api/tags`. */
	readonly running: boolean;
	/** Nomes de modelos disponíveis (ex.: `llama3.2:latest`). */
	readonly models: string[];
}

export type OllamaRuntimeIssue = 'not_installed' | 'installed_stopped' | 'running_no_model';

export interface IOllamaRuntimeAssessment {
	readonly issue?: OllamaRuntimeIssue;
	readonly installed: boolean;
	readonly running: boolean;
	readonly hasRequiredModel: boolean;
	readonly ready: boolean;
	readonly models: string[];
	readonly version?: string;
}

/** Normaliza a URL do Ollama removendo a barra final. */
export function normalizeOllamaUrl(url: string | undefined): string {
	const raw = (url || '').trim() || 'http://127.0.0.1:11434';
	return raw.replace(/\/+$/, '');
}

/**
 * Verifica se o Ollama está acessível e quais modelos tem instalados.
 * Best-effort: qualquer erro de rede resulta em `running: false`.
 */
export async function probeOllama(
	requestService: IRequestService,
	url: string,
	token: CancellationToken = CancellationToken.None,
): Promise<IOllamaProbeResult> {
	try {
		const context = await requestService.request(
			{ type: 'GET', url: `${normalizeOllamaUrl(url)}/api/tags`, callSite: NO_FETCH_TELEMETRY },
			token,
		);
		if (context.res.statusCode && context.res.statusCode >= 400) {
			return { running: false, models: [] };
		}
		const body = await asJson<IOllamaTagsResponse>(context);
		const models = (body?.models ?? [])
			.map(m => (m.name || m.model || '').trim())
			.filter(name => name.length > 0);
		return { running: true, models };
	} catch {
		return { running: false, models: [] };
	}
}

/** Versão do runtime Ollama (`GET /api/version`). */
export async function probeOllamaVersion(
	requestService: IRequestService,
	url: string,
	token: CancellationToken = CancellationToken.None,
): Promise<string | undefined> {
	try {
		const context = await requestService.request(
			{ type: 'GET', url: `${normalizeOllamaUrl(url)}/api/version`, callSite: NO_FETCH_TELEMETRY },
			token,
		);
		if (context.res.statusCode && context.res.statusCode >= 400) {
			return undefined;
		}
		const body = await asJson<IOllamaVersionResponse>(context);
		return body?.version?.trim() || undefined;
	} catch {
		return undefined;
	}
}

export function assessOllamaHealth(
	probe: IOllamaProbeResult,
	requiredModel: string,
	version?: string,
): IOllamaHealthStatus {
	const hasRequiredModel = hasModel(probe.models, requiredModel);
	return {
		running: probe.running,
		models: probe.models,
		version,
		hasRequiredModel,
		ready: probe.running && hasRequiredModel,
	};
}

/** Verifica se o binário do Ollama existe no sistema (best-effort por SO). */
export async function detectOllamaInstalled(
	fileService: IFileService,
	userHome: URI,
): Promise<boolean> {
	const candidates: URI[] = [];
	if (isWindows) {
		candidates.push(joinPath(userHome, 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'));
	} else if (isMacintosh) {
		candidates.push(joinPath(userHome, 'Applications', 'Ollama.app'));
		candidates.push(URI.file('/usr/local/bin/ollama'));
		candidates.push(URI.file('/opt/homebrew/bin/ollama'));
	} else if (isLinux) {
		candidates.push(URI.file('/usr/local/bin/ollama'));
		candidates.push(URI.file('/usr/bin/ollama'));
	}
	for (const candidate of candidates) {
		if (await fileService.exists(candidate)) {
			return true;
		}
	}
	return false;
}

export function resolveOllamaRuntimeIssue(
	probe: IOllamaProbeResult,
	requiredModel: string,
	installed: boolean,
	version?: string,
): IOllamaRuntimeAssessment {
	const hasRequiredModel = hasModel(probe.models, requiredModel);
	const ready = probe.running && hasRequiredModel;
	let issue: OllamaRuntimeIssue | undefined;
	if (!ready) {
		if (!installed && !probe.running) {
			issue = 'not_installed';
		} else if (!probe.running) {
			issue = 'installed_stopped';
		} else {
			issue = 'running_no_model';
		}
	}
	return {
		issue,
		installed: installed || probe.running,
		running: probe.running,
		hasRequiredModel,
		ready,
		models: probe.models,
		version,
	};
}

/**
 * Indica se a lista de modelos contém o modelo pedido. O Ollama qualifica os
 * modelos com tag (`llama3.2:latest`), por isso comparamos pela base antes do `:`.
 */
export function hasModel(models: readonly string[], model: string): boolean {
	const target = model.trim().toLowerCase();
	if (!target) {
		return false;
	}
	const targetBase = target.split(':')[0];
	return models.some(name => {
		const lower = name.toLowerCase();
		return lower === target || lower.split(':')[0] === targetBase;
	});
}

export type LocalLlmShell = 'powershell' | 'bash';

export interface ILocalLlmInstallPlan {
	readonly shell: LocalLlmShell;
	readonly command: string;
	/** `false` quando não conseguimos automatizar a instalação nesta plataforma. */
	readonly automatable: boolean;
	readonly windowTitle: string;
}

/** Instala o Ollama (se necessário) e inicia o servidor. */
export function buildOllamaInstallPlan(): ILocalLlmInstallPlan {
	if (isWindows) {
		const command = [
			'$ErrorActionPreference = "Stop";',
			'$ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source;',
			'if (-not $ollama) { $ollama = "$env:LOCALAPPDATA\\Programs\\Ollama\\ollama.exe" }',
			'if (-not (Test-Path $ollama)) {',
			'  Write-Host "Instalando o Ollama via winget...";',
			'  winget install --id Ollama.Ollama -e --silent --accept-source-agreements --accept-package-agreements;',
			'  $ollama = "$env:LOCALAPPDATA\\Programs\\Ollama\\ollama.exe"',
			'}',
			'Write-Host "A iniciar o Ollama...";',
			'Start-Process -FilePath $ollama -ArgumentList "serve" -WindowStyle Hidden -ErrorAction SilentlyContinue;',
			'Start-Sleep -Seconds 3;',
			'Write-Host "Ollama instalado e em execução.";',
		].join(' ');
		return { shell: 'powershell', command, automatable: true, windowTitle: 'Open Polvo · Instalar Ollama' };
	}

	if (isLinux) {
		const command = [
			'set -e;',
			'if ! command -v ollama >/dev/null 2>&1; then',
			'  echo "Instalando o Ollama...";',
			'  curl -fsSL https://ollama.com/install.sh | sh;',
			'fi;',
			'(ollama serve >/dev/null 2>&1 &) ; sleep 3;',
			'echo "Ollama instalado e em execução.";',
		].join(' ');
		return { shell: 'bash', command, automatable: true, windowTitle: 'Open Polvo · Instalar Ollama' };
	}

	if (isMacintosh) {
		const command = [
			'set -e;',
			'if ! command -v ollama >/dev/null 2>&1; then',
			'  if command -v brew >/dev/null 2>&1; then',
			'    echo "Instalando o Ollama via Homebrew...";',
			'    brew install --cask ollama;',
			'  else',
			'    echo "Instale o Ollama em https://ollama.com/download e volte a executar.";',
			'    open "https://ollama.com/download";',
			'    exit 0;',
			'  fi;',
			'fi;',
			'(ollama serve >/dev/null 2>&1 &) ; sleep 3;',
			'echo "Ollama instalado e em execução.";',
		].join(' ');
		return { shell: 'bash', command, automatable: true, windowTitle: 'Open Polvo · Instalar Ollama' };
	}

	return { shell: 'bash', command: 'echo "Plataforma não suportada"', automatable: false, windowTitle: 'Open Polvo · Ollama' };
}

/** Inicia o servidor Ollama quando o binário já está instalado. */
export function buildOllamaStartPlan(): ILocalLlmInstallPlan {
	if (isWindows) {
		const command = [
			'$ErrorActionPreference = "Stop";',
			'$ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source;',
			'if (-not $ollama) { $ollama = "$env:LOCALAPPDATA\\Programs\\Ollama\\ollama.exe" }',
			'if (-not (Test-Path $ollama)) { Write-Error "Ollama não encontrado."; exit 1 }',
			'Write-Host "A iniciar o Ollama...";',
			'Start-Process -FilePath $ollama -ArgumentList "serve" -WindowStyle Hidden -ErrorAction SilentlyContinue;',
			'Start-Sleep -Seconds 3;',
			'Write-Host "Ollama em execução.";',
		].join(' ');
		return { shell: 'powershell', command, automatable: true, windowTitle: 'Open Polvo · Iniciar Ollama' };
	}

	const command = [
		'set -e;',
		'if ! command -v ollama >/dev/null 2>&1; then echo "Ollama não encontrado."; exit 1; fi;',
		'(ollama serve >/dev/null 2>&1 &) ; sleep 3;',
		'echo "Ollama em execução.";',
	].join(' ');
	return { shell: 'bash', command, automatable: isLinux || isMacintosh, windowTitle: 'Open Polvo · Iniciar Ollama' };
}

/** Baixa o modelo local quando o Ollama já está a correr. */
export function buildOllamaModelPullPlan(model: string): ILocalLlmInstallPlan {
	const safeModel = sanitizeModel(model);
	if (isWindows) {
		const command = [
			'$ErrorActionPreference = "Stop";',
			'$ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source;',
			'if (-not $ollama) { $ollama = "$env:LOCALAPPDATA\\Programs\\Ollama\\ollama.exe" }',
			`Write-Host "A baixar o modelo ${safeModel} (pode demorar)...";`,
			`& $ollama pull ${safeModel};`,
			'Write-Host "Modelo pronto.";',
		].join(' ');
		return { shell: 'powershell', command, automatable: true, windowTitle: 'Open Polvo · Modelo IA' };
	}

	const command = [
		'set -e;',
		`echo "A baixar o modelo ${safeModel} (pode demorar)...";`,
		`ollama pull ${safeModel};`,
		'echo "Modelo pronto.";',
	].join(' ');
	return { shell: 'bash', command, automatable: isLinux || isMacintosh, windowTitle: 'Open Polvo · Modelo IA' };
}

/**
 * Monta o comando de instalação do Ollama + pull do modelo padrão, por SO.
 * O comando é idempotente: salta a instalação se o Ollama já existir e apenas
 * baixa o modelo em falta.
 */
export function buildInstallPlan(model: string): ILocalLlmInstallPlan {
	const safeModel = sanitizeModel(model);
	const install = buildOllamaInstallPlan();
	const pull = buildOllamaModelPullPlan(safeModel);

	if (isWindows) {
		const command = [
			install.command.replace('Write-Host "Ollama instalado e em execução.";', ''),
			`Write-Host "A baixar o modelo ${safeModel} (pode demorar)...";`,
			`& $ollama pull ${safeModel};`,
			'Write-Host "Open Polvo: IA local pronta.";',
		].join(' ');
		return { shell: 'powershell', command, automatable: true, windowTitle: 'Open Polvo · IA local' };
	}

	const command = [
		install.command.replace('echo "Ollama instalado e em execução.";', ''),
		pull.command.replace('set -e;', ''),
		'echo "Open Polvo: IA local pronta.";',
	].join(' ');
	return { shell: pull.shell, command, automatable: pull.automatable, windowTitle: 'Open Polvo · IA local' };
}

/** Evita injeção no comando: só nome de modelo Ollama válido. */
function sanitizeModel(model: string): string {
	const cleaned = (model || '').trim();
	if (/^[a-zA-Z0-9._:\/-]+$/.test(cleaned)) {
		return cleaned;
	}
	return 'llama3.2';
}
