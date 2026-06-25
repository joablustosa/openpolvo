/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { exec } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import type { IOpenPolvoToolCall } from '../../common/openpolvoBackendProtocol.js';

const execAsync = promisify(exec);

const MAX_OUTPUT = 200_000;
const COMMAND_TIMEOUT_MS = 120_000;

function truncate(text: string): string {
	return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n…(saída truncada)` : text;
}

/** Resolve um caminho relativo dentro do workspace, impedindo escapar da raiz. */
function safeResolve(workspacePath: string, relPath: string): string | undefined {
	const target = path.resolve(workspacePath, relPath || '.');
	const root = path.resolve(workspacePath);
	if (target !== root && !target.startsWith(root + path.sep)) {
		return undefined;
	}
	return target;
}

function argString(args: Record<string, unknown>, ...keys: string[]): string {
	for (const key of keys) {
		const v = args[key];
		if (typeof v === 'string') {
			return v;
		}
	}
	return '';
}

/**
 * Executa as tools Desk localmente (filesystem/terminal/git) usando Node, equivalente ao
 * bridge Electron do front antigo. Devolve sempre um objeto serializável `{ ok, ... }`.
 */
export async function runDeskTool(
	call: IOpenPolvoToolCall,
	workspacePath: string | undefined,
): Promise<Record<string, unknown>> {
	const wp = (workspacePath ?? '').trim();
	if (!wp) {
		return { ok: false, error: 'workspace_required' };
	}
	const args = call.args ?? {};

	try {
		switch (call.tool) {
			case 'filesystem_list': {
				const target = safeResolve(wp, argString(args, 'rel_path', 'path'));
				if (!target) {
					return { ok: false, error: 'invalid_path' };
				}
				const dirents = await fs.readdir(target, { withFileTypes: true });
				const entries = dirents.map(d => ({ name: d.name, type: d.isDirectory() ? 'dir' : 'file' }));
				return { ok: true, entries };
			}
			case 'filesystem_read': {
				const target = safeResolve(wp, argString(args, 'rel_path', 'path'));
				if (!target) {
					return { ok: false, error: 'invalid_path' };
				}
				const content = await fs.readFile(target, 'utf8');
				return { ok: true, content: truncate(content) };
			}
			case 'filesystem_write': {
				const rel = argString(args, 'rel_path', 'path');
				const target = safeResolve(wp, rel);
				if (!target) {
					return { ok: false, error: 'invalid_path' };
				}
				await fs.mkdir(path.dirname(target), { recursive: true });
				await fs.writeFile(target, argString(args, 'content'), 'utf8');
				return { ok: true };
			}
			case 'terminal_run': {
				const command = argString(args, 'command');
				if (!command.trim()) {
					return { ok: false, error: 'command_required' };
				}
				return await runCommand(command, wp);
			}
			case 'git_status':
				return await runCommand('git status --short --branch', wp);
			case 'git_diff': {
				const rel = argString(args, 'rel_path', 'path');
				const cmd = rel ? `git diff -- ${JSON.stringify(rel)}` : 'git diff';
				return await runCommand(cmd, wp);
			}
			case 'git_commit': {
				const message = argString(args, 'message');
				if (!message.trim()) {
					return { ok: false, error: 'message_required' };
				}
				return await runCommand(`git add -A && git commit -m ${JSON.stringify(message)}`, wp);
			}
			default:
				return { ok: false, error: `unknown_tool:${call.tool}` };
		}
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}

async function runCommand(command: string, cwd: string): Promise<Record<string, unknown>> {
	try {
		const { stdout, stderr } = await execAsync(command, {
			cwd,
			timeout: COMMAND_TIMEOUT_MS,
			maxBuffer: MAX_OUTPUT * 2,
			windowsHide: true,
		});
		const output = truncate([stdout, stderr].filter(Boolean).join('\n').trim());
		return { ok: true, exit_code: 0, output };
	} catch (err) {
		const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
		const output = truncate([e.stdout, e.stderr].filter(Boolean).join('\n').trim() || (e.message ?? ''));
		return { ok: false, exit_code: typeof e.code === 'number' ? e.code : 1, output, error: e.message };
	}
}
