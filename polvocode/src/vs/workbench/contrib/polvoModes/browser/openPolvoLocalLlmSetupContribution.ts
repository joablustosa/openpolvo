/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout, IntervalTimer, timeout } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { isWindows } from '../../../../base/common/platform.js';
import { joinPath } from '../../../../base/common/resources.js';
import { localize } from '../../../../nls.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { IRequestService } from '../../../../platform/request/common/request.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import {
	OPENPOLVO_DEFAULT_LOCAL_MODEL,
	OPENPOLVO_DEFAULT_OLLAMA_URL,
	OpenPolvoAgentEnabledSettingId,
	OpenPolvoLocalLlmAutoSetupSettingId,
	OpenPolvoLocalLlmModelSettingId,
	OpenPolvoLocalLlmOllamaUrlSettingId,
} from '../../../../platform/agentHost/common/openpolvoConfiguration.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IHostService } from '../../../services/host/browser/host.js';
import {
	buildInstallPlan,
	buildOllamaInstallPlan,
	buildOllamaModelPullPlan,
	buildOllamaStartPlan,
	detectOllamaInstalled,
	hasModel,
	probeOllama,
	probeOllamaVersion,
	resolveOllamaRuntimeIssue,
	type ILocalLlmInstallPlan,
	type OllamaRuntimeIssue,
} from './openPolvoLocalLlm.js';

const BOOTSTRAP_STATE_KEY = 'openpolvo.localLlm.bootstrapState';
const LAST_OLLAMA_VERSION_KEY = 'openpolvo.localLlm.lastOllamaVersion';
const OLLAMA_INSTALLED_KEY = 'openpolvo.localLlm.installed';
const LAST_UPGRADE_CHECK_KEY = 'openpolvo.localLlm.lastUpgradeCheck';
const STATE_DONE = 'done';

/** Quanto esperar após o restore para não competir com o arranque do workbench. */
const INITIAL_DELAY_MS = 4_000;
/** Verificação contínua do Ollama enquanto a app está aberta. */
const HEALTH_CHECK_INTERVAL_MS = 45_000;
/** Intervalo de polling enquanto o modelo é baixado. */
const POLL_INTERVAL_MS = 4_000;
/** Limite total de espera pelo download (modelos podem ser grandes). */
const MAX_WAIT_MS = 45 * 60 * 1000;

/**
 * Monitoriza o Ollama continuamente e, quando necessário, abre uma janela para
 * instalar (se ausente) ou iniciar (se instalado mas parado).
 */
export class OpenPolvoLocalLlmSetupContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.openPolvoLocalLlmSetup';

	private installing = false;
	private prompting = false;
	private lastPromptedIssue: OllamaRuntimeIssue | undefined;
	private upgradeCheckInFlight = false;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
		@IRequestService private readonly requestService: IRequestService,
		@INotificationService private readonly notificationService: INotificationService,
		@IProgressService private readonly progressService: IProgressService,
		@IDialogService private readonly dialogService: IDialogService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IFileService private readonly fileService: IFileService,
		@IHostService private readonly hostService: IHostService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		if (this.configurationService.getValue<boolean>(OpenPolvoAgentEnabledSettingId) === false) {
			return;
		}
		if (this.configurationService.getValue<boolean>(OpenPolvoLocalLlmAutoSetupSettingId) === false) {
			return;
		}

		this._register(disposableTimeout(() => void this.checkOllamaHealth(), INITIAL_DELAY_MS));
		const healthTimer = this._register(new IntervalTimer());
		healthTimer.cancelAndSet(() => void this.checkOllamaHealth(), HEALTH_CHECK_INTERVAL_MS);
		this._register(this.hostService.onDidChangeFocus(focused => {
			if (focused) {
				void this.checkOllamaHealth();
			}
		}));
	}

	private get model(): string {
		return (this.configurationService.getValue<string>(OpenPolvoLocalLlmModelSettingId) || '').trim() || OPENPOLVO_DEFAULT_LOCAL_MODEL;
	}

	private get ollamaUrl(): string {
		return (this.configurationService.getValue<string>(OpenPolvoLocalLlmOllamaUrlSettingId) || '').trim() || OPENPOLVO_DEFAULT_OLLAMA_URL;
	}

	private async checkOllamaHealth(): Promise<void> {
		if (this.installing || this.prompting) {
			return;
		}

		const model = this.model;
		const url = this.ollamaUrl;
		const probe = await probeOllama(this.requestService, url);
		const version = probe.running ? await probeOllamaVersion(this.requestService, url) : undefined;
		const installedOnDisk = await detectOllamaInstalled(this.fileService, this.environmentService.userHome)
			|| this.storageService.get(OLLAMA_INSTALLED_KEY, StorageScope.APPLICATION) === 'true';
		const assessment = resolveOllamaRuntimeIssue(probe, model, installedOnDisk, version);

		if (version) {
			const previousVersion = this.storageService.get(LAST_OLLAMA_VERSION_KEY, StorageScope.APPLICATION);
			if (previousVersion && previousVersion !== version) {
				this.notificationService.info(localize(
					'openpolvo.localLlm.versionUpdated',
					"Ollama atualizado para a versão {0}.",
					version,
				));
			}
			this.storageService.store(LAST_OLLAMA_VERSION_KEY, version, StorageScope.APPLICATION, StorageTarget.MACHINE);
		}

		if (assessment.ready) {
			this.markInstalled();
			this.markDone();
			this.lastPromptedIssue = undefined;
			this.logService.trace(`[OpenPolvo] Ollama pronto (v${version ?? '?'}, modelo ${model})`);
			if (isWindows) {
				void this.maybeUpgradeOllamaInBackground();
			}
			return;
		}

		if (!assessment.issue || assessment.issue === this.lastPromptedIssue) {
			return;
		}

		this.logService.info(`[OpenPolvo] Ollama: issue=${assessment.issue}, running=${probe.running}, models=${probe.models.length}`);
		await this.promptForIssue(assessment.issue, model);
	}

	private async promptForIssue(issue: OllamaRuntimeIssue, model: string): Promise<void> {
		this.prompting = true;
		this.lastPromptedIssue = issue;

		try {
			if (issue === 'not_installed') {
				const { confirmed } = await this.dialogService.confirm({
					type: Severity.Info,
					message: localize('openpolvo.localLlm.dialogInstallTitle', "Ollama não encontrado"),
					detail: localize(
						'openpolvo.localLlm.dialogInstallDetail',
						"O Open Polvo precisa do Ollama para funcionar com IA local gratuita. Deseja instalar agora? Abriremos uma janela com o progresso.",
					),
					primaryButton: localize('openpolvo.localLlm.dialogInstallAction', "Instalar"),
				});
				if (confirmed) {
					await this.runPlan(buildOllamaInstallPlan(), model, 'runtime');
				}
				return;
			}

			if (issue === 'installed_stopped') {
				const { confirmed } = await this.dialogService.confirm({
					type: Severity.Info,
					message: localize('openpolvo.localLlm.dialogStartTitle', "Ollama parado"),
					detail: localize(
						'openpolvo.localLlm.dialogStartDetail',
						"O Ollama está instalado mas não está em execução. Deseja iniciar agora?",
					),
					primaryButton: localize('openpolvo.localLlm.dialogStartAction', "Iniciar"),
				});
				if (confirmed) {
					await this.runPlan(buildOllamaStartPlan(), model, 'runtime');
				}
				return;
			}

			const { confirmed } = await this.dialogService.confirm({
				type: Severity.Info,
				message: localize('openpolvo.localLlm.dialogModelTitle', "Modelo de IA em falta"),
				detail: localize(
					'openpolvo.localLlm.dialogModelDetail',
					"O Ollama está a correr mas o modelo {0} ainda não foi baixado. Deseja transferir agora?",
					model,
				),
				primaryButton: localize('openpolvo.localLlm.dialogModelAction', "Baixar modelo"),
			});
			if (confirmed) {
				await this.runPlan(buildOllamaModelPullPlan(model), model, 'model');
			}
		} finally {
			this.prompting = false;
		}
	}

	private async runPlan(plan: ILocalLlmInstallPlan, model: string, mode: 'runtime' | 'model' | 'full'): Promise<void> {
		const effectivePlan = mode === 'full' ? buildInstallPlan(model) : plan;
		if (this.installing) {
			return;
		}
		this.installing = true;

		const startedInTerminal = await this.tryStartPlanInIntegratedTerminal(effectivePlan);
		if (!startedInTerminal) {
			const startedExternally = await this.tryStartPlanInExternalShell(effectivePlan);
			if (!startedExternally) {
				this.installing = false;
				this.notificationService.error(localize(
					'openpolvo.localLlm.startError',
					"Não foi possível abrir a janela de configuração do Ollama. Execute no terminal: node polvocode/node_modules/node-pty/scripts/post-install.js e reinicie o app.",
				));
				return;
			}
		}

		await this.trackProgress(model, mode);
	}

	private async maybeUpgradeOllamaInBackground(): Promise<void> {
		if (this.upgradeCheckInFlight) {
			return;
		}
		// Uma verificação por dia — evita janelas CMD a piscar a cada health check / foco.
		const today = new Date().toISOString().slice(0, 10);
		if (this.storageService.get(LAST_UPGRADE_CHECK_KEY, StorageScope.APPLICATION) === today) {
			return;
		}
		this.upgradeCheckInFlight = true;
		try {
			const nativeHostService = this.instantiationService.invokeFunction(accessor => accessor.get(INativeHostService));
			const environmentService = this.instantiationService.invokeFunction(accessor => accessor.get(IEnvironmentService));
			const fileService = this.instantiationService.invokeFunction(accessor => accessor.get(IFileService));

			const dir = joinPath(environmentService.tmpDir, 'openpolvo-local-llm');
			await fileService.createFolder(dir);

			const scriptUri = joinPath(dir, 'upgrade-ollama.ps1');
			const script = [
				'$ErrorActionPreference = "SilentlyContinue"',
				'winget upgrade --id Ollama.Ollama -e --silent --accept-source-agreements --accept-package-agreements',
				'',
			].join('\r\n');
			await fileService.writeFile(scriptUri, VSBuffer.fromString(script, 'utf8'));

			const launcherUri = joinPath(dir, 'upgrade-ollama.cmd');
			const launcher = [
				'@echo off',
				`start /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${scriptUri.fsPath}"`,
				'',
			].join('\r\n');
			await fileService.writeFile(launcherUri, VSBuffer.fromString(launcher, 'utf8'));
			await nativeHostService.openExternal(launcherUri.toString(true));
			this.storageService.store(LAST_UPGRADE_CHECK_KEY, today, StorageScope.APPLICATION, StorageTarget.MACHINE);
		} catch (err) {
			this.logService.trace('[OpenPolvo] Verificação de atualização do Ollama ignorada', err);
		} finally {
			this.upgradeCheckInFlight = false;
		}
	}

	private async tryStartPlanInIntegratedTerminal(plan: ILocalLlmInstallPlan): Promise<boolean> {
		try {
			const { ITerminalService } = await import('../../terminal/browser/terminal.js');
			const terminalService = this.instantiationService.invokeFunction(accessor => accessor.get(ITerminalService));
			const instance = await terminalService.createTerminal({
				config: { name: plan.windowTitle },
			});
			terminalService.setActiveInstance(instance);
			await terminalService.focusInstance(instance);
			await instance.sendText(plan.command, true);
			return true;
		} catch (err) {
			this.logService.warn('[OpenPolvo] Terminal integrado indisponível para Ollama', err);
			return false;
		}
	}

	private async tryStartPlanInExternalShell(plan: ILocalLlmInstallPlan): Promise<boolean> {
		if (!isWindows || !plan.automatable) {
			return false;
		}
		try {
			const fileService = this.instantiationService.invokeFunction(accessor => accessor.get(IFileService));
			const nativeHostService = this.instantiationService.invokeFunction(accessor => accessor.get(INativeHostService));
			const environmentService = this.instantiationService.invokeFunction(accessor => accessor.get(IEnvironmentService));

			const dir = joinPath(environmentService.tmpDir, 'openpolvo-local-llm');
			await fileService.createFolder(dir);

			const scriptUri = joinPath(dir, 'ollama-action.ps1');
			await fileService.writeFile(scriptUri, VSBuffer.fromString(plan.command, 'utf8'));

			const launcherUri = joinPath(dir, 'ollama-action.cmd');
			const launcher = [
				'@echo off',
				`start "${plan.windowTitle}" powershell.exe -NoProfile -ExecutionPolicy Bypass -NoExit -File "${scriptUri.fsPath}"`,
				'',
			].join('\r\n');
			await fileService.writeFile(launcherUri, VSBuffer.fromString(launcher, 'utf8'));

			await nativeHostService.openExternal(launcherUri.toString(true));
			this.notificationService.info(localize(
				'openpolvo.localLlm.externalShell',
				"A operação abriu numa janela PowerShell separada. Acompanhe o progresso nessa janela.",
			));
			return true;
		} catch (err) {
			this.logService.error('[OpenPolvo] Falha ao abrir shell externa para Ollama', err);
			return false;
		}
	}

	private async trackProgress(model: string, mode: 'runtime' | 'model' | 'full'): Promise<void> {
		const progressTitle = mode === 'model'
			? localize('openpolvo.localLlm.progressModel', "Open Polvo: a baixar o modelo {0}…", model)
			: localize('openpolvo.localLlm.progress', "Open Polvo: a preparar o Ollama…");

		await this.progressService.withProgress(
			{
				location: ProgressLocation.Notification,
				title: progressTitle,
				cancellable: true,
			},
			async (progress, token) => {
				const url = this.ollamaUrl;
				const started = Date.now();
				let runtimeReady = false;

				while (!token.isCancellationRequested && Date.now() - started < MAX_WAIT_MS) {
					const probe = await probeOllama(this.requestService, url, token);

					if (probe.running) {
						this.markInstalled();
					}
					if (probe.running && !runtimeReady) {
						runtimeReady = true;
						if (mode !== 'runtime') {
							progress.report({ message: localize('openpolvo.localLlm.downloading', "Ollama pronto — a baixar o modelo {0}…", model) });
						}
					}
					if (probe.running && (mode === 'runtime' || hasModel(probe.models, model))) {
						this.markDone();
						const version = await probeOllamaVersion(this.requestService, url, token);
						if (version) {
							this.storageService.store(LAST_OLLAMA_VERSION_KEY, version, StorageScope.APPLICATION, StorageTarget.MACHINE);
						}
						this.lastPromptedIssue = undefined;
						const message = mode === 'runtime'
							? localize('openpolvo.localLlm.runtimeReady', "Ollama em execução.")
							: localize('openpolvo.localLlm.ready', "IA local pronta. O Open Polvo funciona com o modelo {0}.", model);
						this.notificationService.info(message);
						return;
					}

					try {
						await timeout(POLL_INTERVAL_MS, token);
					} catch {
						break;
					}
				}

				if (!token.isCancellationRequested) {
					this.notificationService.warn(localize(
						'openpolvo.localLlm.timeout',
						"A operação está a demorar. Acompanhe o progresso na janela do Ollama.",
					));
				}
			},
		).finally(() => {
			this.installing = false;
		});
	}

	private markInstalled(): void {
		this.storageService.store(OLLAMA_INSTALLED_KEY, 'true', StorageScope.APPLICATION, StorageTarget.MACHINE);
	}

	private markDone(): void {
		this.storageService.store(BOOTSTRAP_STATE_KEY, STATE_DONE, StorageScope.APPLICATION, StorageTarget.MACHINE);
	}
}
