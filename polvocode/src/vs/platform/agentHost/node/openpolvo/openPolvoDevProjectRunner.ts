/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { exec, spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';
import { readProjectRootFromMetadata } from '../../common/openPolvoDevProject.js';

const execAsync = promisify(exec);

const INSTALL_TIMEOUT_MS = 300_000;
const runningDevServers = new Map<string, ChildProcess>();

export interface IDevProjectSetupMetadata {
	readonly npmInstall: boolean;
	readonly runDev: boolean;
	readonly devCommand: string;
	readonly projectRootRel?: string;
	readonly createProject: boolean;
	readonly openWorkspace: boolean;
}

export function readDevProjectSetup(metadata: Record<string, unknown> | undefined): IDevProjectSetupMetadata {
	return {
		npmInstall: metadata?.polvo_code_npm_install === true,
		runDev: metadata?.polvo_code_run_dev === true,
		devCommand: typeof metadata?.polvo_code_dev_command === 'string' && metadata.polvo_code_dev_command.trim()
			? metadata.polvo_code_dev_command.trim()
			: 'npm run dev',
		projectRootRel: readProjectRootFromMetadata(metadata),
		createProject: metadata?.polvo_code_create_project === true,
		openWorkspace: metadata?.polvo_code_open_workspace === true,
	};
}

function resolveProjectCwd(workspacePath: string, projectRootRel?: string): string {
	const wp = workspacePath.trim();
	if (!projectRootRel?.trim()) {
		return wp;
	}
	return path.join(wp, ...projectRootRel.split('/').filter(Boolean));
}

async function pathExists(absPath: string): Promise<boolean> {
	try {
		await fs.stat(absPath);
		return true;
	} catch {
		return false;
	}
}

async function detectProjectLayout(projectCwd: string): Promise<{
	hasRootNode: boolean;
	hasRootGo: boolean;
	hasFrontendNode: boolean;
	hasBackendGo: boolean;
	isMonorepo: boolean;
}> {
	const hasRootNode = await pathExists(path.join(projectCwd, 'package.json'));
	const hasRootGo = await pathExists(path.join(projectCwd, 'go.mod'));
	const hasFrontendNode = await pathExists(path.join(projectCwd, 'frontend', 'package.json'));
	const hasBackendGo = await pathExists(path.join(projectCwd, 'backend', 'go.mod'));
	return {
		hasRootNode,
		hasRootGo,
		hasFrontendNode,
		hasBackendGo,
		isMonorepo: hasFrontendNode && hasBackendGo,
	};
}

function resolveDevCommand(setup: IDevProjectSetupMetadata, layout: { isMonorepo: boolean }): string {
	const cmd = setup.devCommand.trim();
	if (layout.isMonorepo && cmd === 'make dev') {
		return process.platform === 'win32' ? 'powershell -ExecutionPolicy Bypass -File dev.ps1' : 'make dev';
	}
	return cmd;
}

async function runBlockingCommand(command: string, cwd: string): Promise<void> {
	await execAsync(command, {
		cwd,
		timeout: INSTALL_TIMEOUT_MS,
		maxBuffer: 2_000_000,
		windowsHide: true,
	});
}

function spawnDetachedDevServer(command: string, cwd: string): void {
	const key = cwd.toLowerCase();
	const existing = runningDevServers.get(key);
	if (existing && !existing.killed) {
		return;
	}
	const child = spawn(command, {
		cwd,
		shell: true,
		detached: true,
		stdio: 'ignore',
		windowsHide: true,
	});
	child.unref();
	runningDevServers.set(key, child);
	child.on('exit', () => {
		if (runningDevServers.get(key) === child) {
			runningDevServers.delete(key);
		}
	});
}

/**
 * Instala dependências e arranca o dev server após criar um projecto novo.
 * Em projectos existentes só corre `npm install` quando solicitado na metadata.
 */
export async function runDevProjectPostSetup(
	workspacePath: string,
	setup: IDevProjectSetupMetadata,
): Promise<{ projectCwd: string; devStarted: boolean } | undefined> {
	const wp = workspacePath.trim();
	if (!wp) {
		return undefined;
	}
	let projectCwd = resolveProjectCwd(wp, setup.projectRootRel);
	if (!(await pathExists(projectCwd))) {
		return undefined;
	}
	const layout = await detectProjectLayout(projectCwd);
	const hasNode = layout.hasRootNode || layout.hasFrontendNode;
	const hasGo = layout.hasRootGo || layout.hasBackendGo;

	if (setup.npmInstall) {
		if (layout.isMonorepo) {
			await runBlockingCommand('npm install --no-audit --no-fund', path.join(projectCwd, 'frontend'));
			await runBlockingCommand('go mod download', path.join(projectCwd, 'backend'));
		} else if (layout.hasRootNode) {
			await runBlockingCommand('npm install --no-audit --no-fund', projectCwd);
		} else if (layout.hasRootGo) {
			await runBlockingCommand('go mod download', projectCwd);
		}
	}

	let devStarted = false;
	if (setup.runDev && setup.devCommand) {
		const devCommand = resolveDevCommand(setup, layout);
		if (layout.isMonorepo || devCommand.startsWith('make') || devCommand.includes('dev.ps1')) {
			spawnDetachedDevServer(devCommand, projectCwd);
			devStarted = true;
		} else if (hasNode || devCommand.startsWith('npm') || devCommand.startsWith('cd frontend')) {
			spawnDetachedDevServer(devCommand, projectCwd);
			devStarted = true;
		} else if (hasGo) {
			spawnDetachedDevServer(devCommand.startsWith('go') ? devCommand : 'go run .', projectCwd);
			devStarted = true;
		}
	}

	return { projectCwd, devStarted };
}

export function projectRootResourceUri(workspacePath: string, projectRootRel?: string): string | undefined {
	const wp = workspacePath.trim();
	if (!wp) {
		return undefined;
	}
	const abs = resolveProjectCwd(wp, projectRootRel);
	return abs ? pathToFileUrl(abs) : undefined;
}

function pathToFileUrl(absPath: string): string {
	const normalized = absPath.replace(/\\/g, '/');
	if (/^[a-zA-Z]:\//.test(normalized)) {
		return `file:///${normalized}`;
	}
	return `file://${normalized.startsWith('/') ? '' : '/'}${normalized}`;
}
