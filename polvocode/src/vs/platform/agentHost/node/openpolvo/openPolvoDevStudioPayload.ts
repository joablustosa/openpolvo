/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs/promises';
import * as path from 'path';
import type { IBuildChatBodyOptions } from '../../common/openpolvoBackendProtocol.js';

const MAX_FILES = 80;
const MAX_BYTES_PER_FILE = 48_000;

const SKIP_DIRS = new Set([
	'node_modules',
	'.git',
	'dist',
	'build',
	'.next',
	'coverage',
	'__pycache__',
	'out',
	'.build',
]);

const SKIP_EXT = new Set([
	'.png',
	'.jpg',
	'.jpeg',
	'.gif',
	'.webp',
	'.ico',
	'.svg',
	'.woff',
	'.woff2',
	'.lock',
]);

const PRIORITY_SUBSTRINGS = [
	'package.json',
	'middleware',
	'next.config',
	'vite.config',
	'tsconfig',
	'go.mod',
	'src/',
	'app/',
	'internal/',
	'routes',
	'auth',
	'supabase',
];

function shouldIndexFile(relPath: string): boolean {
	const p = relPath.replace(/\\/g, '/');
	if (p.split('/').some(seg => SKIP_DIRS.has(seg))) {
		return false;
	}
	const dot = p.lastIndexOf('.');
	const ext = dot >= 0 ? p.slice(dot).toLowerCase() : '';
	if (SKIP_EXT.has(ext)) {
		return false;
	}
	if (!ext && !PRIORITY_SUBSTRINGS.some(s => p.includes(s))) {
		return false;
	}
	return true;
}

function scorePath(relPath: string): number {
	const p = relPath.toLowerCase();
	let score = 0;
	for (let i = 0; i < PRIORITY_SUBSTRINGS.length; i++) {
		if (p.includes(PRIORITY_SUBSTRINGS[i])) {
			score += 100 - i;
		}
	}
	return score;
}

function trimFileContent(content: string): string {
	const bytes = Buffer.from(content, 'utf8');
	if (bytes.length <= MAX_BYTES_PER_FILE) {
		return content;
	}
	return bytes.subarray(0, MAX_BYTES_PER_FILE).toString('utf8');
}

async function walkWorkspace(
	workspacePath: string,
	relPath: string,
	tree: string[],
): Promise<void> {
	if (tree.length >= MAX_FILES) {
		return;
	}
	const abs = relPath ? path.join(workspacePath, relPath) : workspacePath;
	let entries: fs.Dirent[];
	try {
		entries = await fs.readdir(abs, { withFileTypes: true });
	} catch {
		return;
	}
	for (const ent of entries) {
		if (tree.length >= MAX_FILES) {
			break;
		}
		const rp = relPath ? `${relPath.replace(/\\/g, '/')}/${ent.name}` : ent.name;
		if (ent.isDirectory()) {
			if (!SKIP_DIRS.has(ent.name)) {
				await walkWorkspace(workspacePath, rp, tree);
			}
		} else if (shouldIndexFile(rp)) {
			tree.push(rp);
		}
	}
}

/** Recolhe árvore e conteúdos indexáveis do workspace para o dev workflow (Polvo Code). */
export async function collectWorkspaceProjectFiles(workspacePath: string | undefined): Promise<Record<string, string>> {
	const wp = (workspacePath ?? '').trim();
	if (!wp) {
		return {};
	}
	const tree: string[] = [];
	await walkWorkspace(wp, '', tree);
	tree.sort((a, b) => scorePath(b) - scorePath(a));
	const selected = tree.slice(0, MAX_FILES);
	const files: Record<string, string> = {};
	for (const rel of selected) {
		try {
			const raw = await fs.readFile(path.join(wp, rel), 'utf8');
			files[rel.replace(/\\/g, '/')] = trimFileContent(raw);
		} catch {
			// ignorar ficheiros ilegíveis
		}
	}
	return files;
}

/** Monta payload Dev Studio para POST /v1/conversations/{id}/messages/stream (sem desk_context). */
export async function buildDevStudioStreamOptions(
	workspacePath: string | undefined,
	conversationId: string,
): Promise<NonNullable<IBuildChatBodyOptions['devStudio']>> {
	const wp = (workspacePath ?? '').trim();
	const projectFiles = await collectWorkspaceProjectFiles(wp);
	const tree = Object.keys(projectFiles).sort((a, b) => scorePath(b) - scorePath(a));
	const out: NonNullable<IBuildChatBodyOptions['devStudio']> = {};
	if (wp) {
		out.sandbox_project_id = wp;
	}
	if (tree.length > 0) {
		out.project_file_tree = tree;
		out.project_files = projectFiles;
	}
	if (wp || conversationId) {
		out.dev_studio_context = {
			...(wp ? { project_id: wp, workspace_path: wp } : {}),
			...(conversationId ? { conversation_id: conversationId } : {}),
			mode: 'code',
		};
	}
	return out;
}
