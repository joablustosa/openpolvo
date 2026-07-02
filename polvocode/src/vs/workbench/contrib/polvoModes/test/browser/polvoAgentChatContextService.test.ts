/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { capCodeReferenceText, readCodeReferenceFromEditor } from '../../browser/polvoAgentChatContextService.js';
import type { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import type { ITextModel } from '../../../../../editor/common/model.js';
import type { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';

suite('PolvoAgentChatContextService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('capCodeReferenceText limits bytes', () => {
		const big = 'a'.repeat(20_000);
		const capped = capCodeReferenceText(big, 100);
		assert.ok(new TextEncoder().encode(capped).length <= 100);
	});

	test('readCodeReferenceFromEditor builds reference', () => {
		const uri = URI.file('/workspace/src/app.ts');
		const model = {
			uri,
			getValueInRange: (range: Range) => range.startLineNumber === 2 ? 'hello world' : '',
		} as unknown as ITextModel;
		const editor = {
			getModel: () => model,
			getSelection: () => new Range(2, 1, 2, 12),
		} as unknown as ICodeEditor;
		const workspace = {
			getWorkspaceFolder: () => ({ uri: URI.file('/workspace'), name: 'workspace', index: 0 }),
		} as unknown as IWorkspaceContextService;

		const ref = readCodeReferenceFromEditor(editor, workspace);
		assert.ok(ref);
		assert.strictEqual(ref.relativePath, 'src/app.ts');
		assert.strictEqual(ref.startLine, 2);
		assert.strictEqual(ref.endLine, 2);
		assert.strictEqual(ref.text, 'hello world');
	});
});
