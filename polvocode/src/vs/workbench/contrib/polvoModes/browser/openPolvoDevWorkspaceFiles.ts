/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import {
	normalizeDevRelativePath,
	prefixDevRelativePath,
	readProjectRootFromMetadata,
} from '../../../../platform/agentHost/common/openPolvoDevProject.js';
import { IExplorerService } from '../../files/browser/files.js';
import { IWorkspaceEditingService } from '../../../services/workspaces/common/workspaceEditing.js';

export interface IDevWorkspaceFileOp {
	readonly path: string;
	readonly content?: string;
	readonly op?: 'write' | 'mkdir';
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
