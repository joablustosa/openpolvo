/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { get as httpGet } from 'http';
import { join } from '../../../base/common/path.js';
import { isWindows } from '../../../base/common/platform.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import type { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import type { ILogService } from '../../log/common/log.js';

interface IOpenPolvoDesktopManifest {
	readonly backendPort?: number;
	readonly intelligencePort?: number;
	readonly jwtSecret: string;
	readonly internalKey: string;
	readonly defaultAdminEmail?: string;
	readonly defaultAdminPassword?: string;
}

const DEFAULT_BACKEND_PORT = 8081;
const DEFAULT_INTELLIGENCE_PORT = 8090;
const STARTUP_TIMEOUT_MS = 90_000;
const HEALTH_INTERVAL_MS = 1_500;

function pingHealth(url: string, timeoutMs = 2_000): Promise<boolean> {
	return new Promise(resolve => {
		const req = httpGet(url, { timeout: timeoutMs }, res => {
			res.resume();
			resolve(res.statusCode === 200);
		});
		req.on('error', () => resolve(false));
		req.on('timeout', () => {
			req.destroy();
			resolve(false);
		});
	});
}

async function waitForHealth(url: string, deadlineMs: number): Promise<void> {
	const deadline = Date.now() + deadlineMs;
	let lastError = 'sem resposta';
	while (Date.now() < deadline) {
		try {
			if (await pingHealth(url)) {
				return;
			}
			lastError = 'HTTP not ok';
		} catch (err) {
			lastError = err instanceof Error ? err.message : String(err);
		}
		await new Promise<void>(resolve => setTimeout(resolve, HEALTH_INTERVAL_MS));
	}
	throw new Error(`Serviço OpenPolvo indisponível em ${url} (${lastError})`);
}

function readManifest(resourcesRoot: string): IOpenPolvoDesktopManifest {
	const manifestPath = join(resourcesRoot, 'openpolvo', 'manifest.json');
	const raw = readFileSync(manifestPath, 'utf8');
	return JSON.parse(raw) as IOpenPolvoDesktopManifest;
}

/**
 * Arranca backend Go e Intelligence Python embutidos no instalador desktop.
 * Em dev (`!isBuilt`) ou com `OPENPOLVO_EXTERNAL_SERVICES=1`, não faz nada.
 */
export class OpenPolvoBundledServices extends Disposable {

	private backendProcess: ChildProcessWithoutNullStreams | undefined;
	private intelligenceProcess: ChildProcessWithoutNullStreams | undefined;

	constructor(
		private readonly environmentService: IEnvironmentMainService,
		private readonly logService: ILogService,
	) {
		super();
	}

	async startIfNeeded(): Promise<boolean> {
		if (!this.environmentService.isBuilt) {
			return false;
		}
		if (process.env['OPENPOLVO_EXTERNAL_SERVICES'] === '1') {
			this.logService.info('[OpenPolvo] Serviços externos activos (OPENPOLVO_EXTERNAL_SERVICES=1).');
			return false;
		}

		const resourcesRoot = process.resourcesPath;
		const backendExe = join(resourcesRoot, 'openpolvo', 'backend', isWindows ? 'openlaele-api.exe' : 'openlaele-api');
		const intelligenceExe = join(resourcesRoot, 'openpolvo', 'intelligence', isWindows ? 'openpolvointel.exe' : 'openpolvointel');
		if (!existsSync(backendExe) || !existsSync(intelligenceExe)) {
			this.logService.warn('[OpenPolvo] Binários embutidos não encontrados; arranque manual dos serviços necessário.');
			return false;
		}

		const manifest = readManifest(resourcesRoot);
		const backendPort = manifest.backendPort ?? DEFAULT_BACKEND_PORT;
		const intelligencePort = manifest.intelligencePort ?? DEFAULT_INTELLIGENCE_PORT;
		const dataDir = join(this.environmentService.userDataPath, 'openpolvo-data');
		mkdirSync(dataDir, { recursive: true });

		const backendDir = join(resourcesRoot, 'openpolvo', 'backend');
		const intelligenceDir = join(resourcesRoot, 'openpolvo', 'intelligence');
		const dbPath = join(dataDir, 'openpolvo.db');
		const migrationsPath = join(backendDir, 'migrations');

		const sharedEnv: NodeJS.ProcessEnv = {
			...process.env,
		};

		this.logService.info('[OpenPolvo] A arrancar Intelligence embutida…');
		this.intelligenceProcess = spawn(intelligenceExe, [], {
			cwd: intelligenceDir,
			env: {
				...sharedEnv,
				HOST: '127.0.0.1',
				PORT: String(intelligencePort),
				POLVO_INTERNAL_KEY: manifest.internalKey,
				OLLAMA_BASE_URL: sharedEnv['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434',
				OLLAMA_MODEL: sharedEnv['OLLAMA_MODEL'] ?? 'llama3.2',
			},
			windowsHide: true,
			stdio: 'pipe',
		});
		this.intelligenceProcess.stdout?.on('data', chunk => {
			this.logService.trace(`[OpenPolvo:intel] ${String(chunk).trimEnd()}`);
		});
		this.intelligenceProcess.stderr?.on('data', chunk => {
			this.logService.warn(`[OpenPolvo:intel] ${String(chunk).trimEnd()}`);
		});
		this._register({ dispose: () => this.stopProcess(this.intelligenceProcess) });

		await waitForHealth(`http://127.0.0.1:${intelligencePort}/healthz`, STARTUP_TIMEOUT_MS);

		this.logService.info('[OpenPolvo] A arrancar Backend embutido…');
		this.backendProcess = spawn(backendExe, [], {
			cwd: backendDir,
			env: {
				...sharedEnv,
				HTTP_ADDR: `:${backendPort}`,
				DB_PATH: dbPath,
				MIGRATIONS_PATH: migrationsPath,
				RUN_MIGRATIONS: 'true',
				JWT_SECRET: manifest.jwtSecret,
				JWT_ISSUER: 'open-polvo',
				JWT_ACCESS_TTL: '15m',
				BOOTSTRAP_DEFAULT_ADMIN: 'true',
				DEFAULT_ADMIN_EMAIL: manifest.defaultAdminEmail ?? 'admin@openlaele.local',
				DEFAULT_ADMIN_PASSWORD: manifest.defaultAdminPassword ?? 'ChangeMeLocalDev_Only',
				AUTH_ALLOW_REGISTER: 'false',
				POLVO_INTELLIGENCE_BASE_URL: `http://127.0.0.1:${intelligencePort}`,
				POLVO_INTELLIGENCE_INTERNAL_KEY: manifest.internalKey,
				CORS_ALLOW_NULL_ORIGIN: 'true',
				CORS_ALLOW_VSCODE_FILE_ORIGIN: 'true',
				AGENT_LLM_TIMEOUT: '600s',
			},
			windowsHide: true,
			stdio: 'pipe',
		});
		this.backendProcess.stdout?.on('data', chunk => {
			this.logService.trace(`[OpenPolvo:backend] ${String(chunk).trimEnd()}`);
		});
		this.backendProcess.stderr?.on('data', chunk => {
			this.logService.warn(`[OpenPolvo:backend] ${String(chunk).trimEnd()}`);
		});
		this._register({ dispose: () => this.stopProcess(this.backendProcess) });

		await waitForHealth(`http://127.0.0.1:${backendPort}/healthz`, STARTUP_TIMEOUT_MS);

		process.env['OPENPOLVO_API_BASE_URL'] = `http://127.0.0.1:${backendPort}`;
		process.env['OPENPOLVO_BUNDLED_SERVICES'] = '1';
		this.logService.info(`[OpenPolvo] Serviços embutidos prontos (backend :${backendPort}, intelligence :${intelligencePort}).`);
		return true;
	}

	private stopProcess(child: ChildProcessWithoutNullStreams | undefined): void {
		if (!child || child.killed) {
			return;
		}
		try {
			if (isWindows) {
				spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { windowsHide: true });
			} else {
				child.kill('SIGTERM');
			}
		} catch (err) {
			this.logService.error('[OpenPolvo] Falha ao terminar processo embutido', err);
		}
	}

	override dispose(): void {
		this.stopProcess(this.backendProcess);
		this.stopProcess(this.intelligenceProcess);
		super.dispose();
	}
}

export async function startOpenPolvoBundledServices(
	environmentService: IEnvironmentMainService,
	logService: ILogService,
): Promise<OpenPolvoBundledServices | undefined> {
	const services = new OpenPolvoBundledServices(environmentService, logService);
	try {
		const started = await services.startIfNeeded();
		if (!started) {
			services.dispose();
			return undefined;
		}
	} catch (err) {
		services.dispose();
		logService.error('[OpenPolvo] Falha ao arrancar serviços embutidos', err);
		return undefined;
	}
	app.on('will-quit', () => services.dispose());
	return services;
}
