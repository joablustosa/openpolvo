/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { isWindows } from '../../../../base/common/platform.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import {
	normalizeDevRelativePath,
	prefixDevRelativePath,
	readProjectRootFromMetadata,
	slugifyProjectTitle,
} from '../../../../platform/agentHost/common/openPolvoDevProject.js';
import { IExplorerService } from '../../files/browser/files.js';
import { IWorkspaceEditingService } from '../../../services/workspaces/common/workspaceEditing.js';

export interface IDevWorkspaceFileOp {
	readonly path: string;
	readonly content?: string;
	readonly op?: 'write' | 'mkdir' | 'delete';
}

export interface IDevWorkspacePostSetup {
	readonly gitInit: boolean;
	readonly npmInstall: boolean;
	readonly runDev: boolean;
	readonly devCommand: string;
}

export async function applyDevFileToWorkspaceFolder(
	fileService: IFileService,
	workspaceFolderUri: URI,
	file: IDevWorkspaceFileOp,
	projectRootRel?: string,
): Promise<URI | undefined> {
	const rel = projectRootRel
		? prefixDevRelativePath(projectRootRel, normalizeDevRelativePath(file.path))
		: normalizeDevRelativePath(file.path);
	if (!rel) {
		return undefined;
	}
	const resource = URI.joinPath(workspaceFolderUri, ...rel.split('/'));
	const op = file.op === 'mkdir' ? 'mkdir' : 'write';
	try {
		if (op === 'mkdir') {
			await fileService.createFolder(resource);
		} else if (file.op === 'delete') {
			await fileService.del(resource, { recursive: true, useTrash: true });
		} else {
			const parent = URI.joinPath(resource, '..');
			await fileService.createFolder(parent);
			await fileService.writeFile(resource, VSBuffer.fromString(file.content ?? ''));
		}
		return resource;
	} catch {
		return undefined;
	}
}

function normalizeFolderUri(uri: URI): string {
	return uri.toString().replace(/\/$/, '');
}

async function pathExists(fileService: IFileService, resource: URI): Promise<boolean> {
	try {
		await fileService.stat(resource);
		return true;
	} catch {
		return false;
	}
}

export async function ensureUniquePolvoProjectRoot(
	fileService: IFileService,
	workspaceFolderUri: URI,
	requestedRoot: string,
): Promise<string | undefined> {
	const slug = slugifyProjectTitle(normalizeDevRelativePath(requestedRoot));
	if (!slug) {
		return undefined;
	}
	let candidate = slug;
	let suffix = 0;
	while (await pathExists(fileService, URI.joinPath(workspaceFolderUri, ...candidate.split('/')))) {
		suffix += 1;
		candidate = `${slug}-${suffix}`;
	}
	await fileService.createFolder(URI.joinPath(workspaceFolderUri, ...candidate.split('/')));
	return candidate;
}

/** Adiciona a pasta do projecto ao workspace (se necessário) e revela no Explorer. */
export async function openPolvoProjectFolderInExplorer(
	fileService: IFileService,
	workspaceContextService: IWorkspaceContextService,
	workspaceEditingService: IWorkspaceEditingService,
	explorerService: IExplorerService,
	workspaceFolderUri: URI,
	projectRootRel: string,
): Promise<void> {
	const rel = normalizeDevRelativePath(projectRootRel);
	if (!rel) {
		return;
	}
	const resource = URI.joinPath(workspaceFolderUri, ...rel.split('/').filter(Boolean));
	try {
		await fileService.createFolder(resource);
	} catch {
		// pasta pode já existir
	}
	const target = normalizeFolderUri(resource);
	const isRoot = workspaceContextService.getWorkspace().folders.some(
		f => normalizeFolderUri(f.uri) === target,
	);
	if (!isRoot) {
		try {
			await workspaceEditingService.addFolders([{ uri: resource }]);
		} catch {
			// best-effort
		}
	}
	try {
		await explorerService.refresh();
		await explorerService.select(resource, true);
	} catch {
		// best-effort
	}
}

export function shouldOpenPolvoProjectInExplorer(metadata: Record<string, unknown> | undefined): boolean {
	if (!metadata) {
		return false;
	}
	return metadata.polvo_code_open_workspace === true || metadata.polvo_code_create_project === true;
}

export function projectRootFromMetadata(metadata: Record<string, unknown> | undefined): string | undefined {
	return readProjectRootFromMetadata(metadata);
}

export function readDevWorkspacePostSetup(metadata: Record<string, unknown> | undefined): IDevWorkspacePostSetup {
	return {
		gitInit: metadata?.polvo_code_git_init === true || metadata?.polvo_code_create_project === true,
		npmInstall: metadata?.polvo_code_npm_install === true,
		runDev: metadata?.polvo_code_run_dev === true,
		devCommand: typeof metadata?.polvo_code_dev_command === 'string' && metadata.polvo_code_dev_command.trim()
			? metadata.polvo_code_dev_command.trim()
			: 'npm run dev',
	};
}

async function detectProjectLayout(fileService: IFileService, projectRootUri: URI): Promise<{
	hasRootNode: boolean;
	hasRootGo: boolean;
	hasFrontendNode: boolean;
	hasBackendGo: boolean;
	isMonorepo: boolean;
}> {
	const hasRootNode = await pathExists(fileService, URI.joinPath(projectRootUri, 'package.json'));
	const hasRootGo = await pathExists(fileService, URI.joinPath(projectRootUri, 'go.mod'));
	const hasFrontendNode = await pathExists(fileService, URI.joinPath(projectRootUri, 'frontend', 'package.json'));
	const hasBackendGo = await pathExists(fileService, URI.joinPath(projectRootUri, 'backend', 'go.mod'));
	return {
		hasRootNode,
		hasRootGo,
		hasFrontendNode,
		hasBackendGo,
		isMonorepo: hasFrontendNode && hasBackendGo,
	};
}

function resolveDevCommand(command: string, layout: { isMonorepo: boolean }): string {
	const cmd = command.trim();
	if (layout.isMonorepo && cmd === 'make dev') {
		return isWindows ? 'powershell -ExecutionPolicy Bypass -File dev.ps1' : 'make dev';
	}
	if (cmd === 'cd frontend && npm run dev') {
		return 'npm run dev --prefix frontend';
	}
	return cmd;
}

function buildPostSetupCommands(
	setup: IDevWorkspacePostSetup,
	layout: Awaited<ReturnType<typeof detectProjectLayout>>,
): string[] {
	const commands: string[] = [];
	if (setup.gitInit) {
		commands.push('git init');
	}
	if (setup.npmInstall) {
		if (layout.isMonorepo) {
			commands.push('npm install --no-audit --no-fund --prefix frontend');
			commands.push('go -C backend mod download');
		} else if (layout.hasRootNode) {
			commands.push('npm install --no-audit --no-fund');
		} else if (layout.hasFrontendNode) {
			commands.push('npm install --no-audit --no-fund --prefix frontend');
		} else if (layout.hasRootGo) {
			commands.push('go mod download');
		} else if (layout.hasBackendGo) {
			commands.push('go -C backend mod download');
		}
	}
	if (setup.runDev) {
		commands.push(resolveDevCommand(setup.devCommand, layout));
	}
	return commands;
}

export async function runPolvoProjectPostSetupInTerminal(
	instantiationService: IInstantiationService,
	fileService: IFileService,
	workspaceFolderUri: URI,
	projectRootRel: string,
	metadata: Record<string, unknown> | undefined,
): Promise<boolean> {
	const rel = normalizeDevRelativePath(projectRootRel);
	if (!rel) {
		return false;
	}
	const setup = readDevWorkspacePostSetup(metadata);
	if (!setup.gitInit && !setup.npmInstall && !setup.runDev) {
		return false;
	}
	const projectRootUri = URI.joinPath(workspaceFolderUri, ...rel.split('/'));
	const layout = await detectProjectLayout(fileService, projectRootUri);
	const commands = buildPostSetupCommands(setup, layout);
	if (commands.length === 0) {
		return false;
	}
	const { ITerminalService } = await import('../../terminal/browser/terminal.js');
	const terminalService = instantiationService.invokeFunction(accessor => accessor.get(ITerminalService));
	const instance = await terminalService.createTerminal({
		config: { name: 'OpenPolvo: setup do projecto' },
		cwd: projectRootUri,
	});
	terminalService.setActiveInstance(instance);
	await terminalService.focusInstance(instance);
	await instance.sendText(commands.join('\n'), true);
	return true;
}
