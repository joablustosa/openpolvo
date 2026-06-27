/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as child_process from 'child_process';
import * as fs from 'fs';
import path from 'path';
import { root } from './installStateHash.ts';

const CONPTY_DLL = path.join(root, 'node_modules', 'node-pty', 'build', 'Release', 'conpty', 'conpty.dll');
const POST_INSTALL = path.join(root, 'node_modules', 'node-pty', 'scripts', 'post-install.js');

/**
 * node-pty compila os binários nativos mas copia conpty.dll num script post-install
 * separado. Com build_from_source=true isso por vezes não corre — o terminal integrado
 * falha com "Cannot find conpty.dll".
 */
export function ensureNodePtyConpty(): boolean {
	if (process.platform !== 'win32') {
		return true;
	}
	if (fs.existsSync(CONPTY_DLL)) {
		return true;
	}
	if (!fs.existsSync(POST_INSTALL)) {
		console.warn('[ensureNodePtyConpty] node-pty post-install script not found; run npm install in polvocode.');
		return false;
	}
	console.log('[ensureNodePtyConpty] Copying conpty.dll for integrated terminal...');
	child_process.execSync(`node "${POST_INSTALL}"`, { cwd: root, stdio: 'inherit' });
	return fs.existsSync(CONPTY_DLL);
}

if (import.meta.main) {
	if (!ensureNodePtyConpty()) {
		process.exit(1);
	}
}
