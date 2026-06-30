/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { mergeLocalExtras, reconcileMessageIds, serverMessageToLocal } from '../../browser/polvoAgentHistoryMerge.js';
import type { IPolvoConversationMessage } from '../../browser/polvoAgentConversationsService.js';

suite('PolvoAgentHistoryMerge', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('serverMessageToLocal parses code references metadata', () => {
		const msg = serverMessageToLocal({
			id: 'm1',
			role: 'user',
			content: 'hello',
			metadata: {
				code_references: [{ path: 'a.ts', start_line: 1, end_line: 2, text: 'x' }],
			},
		});
		assert.strictEqual(msg.serverMessageId, 'm1');
		assert.ok(msg.codeReferences);
		assert.strictEqual(msg.codeReferences![0].path, 'a.ts');
	});

	test('mergeLocalExtras preserves local UI extras', () => {
		const server: IPolvoConversationMessage[] = [
			{ role: 'user', content: 'hi' },
			{ role: 'assistant', content: 'ok', serverMessageId: 'a1' },
		];
		const local: IPolvoConversationMessage[] = [
			{ role: 'user', content: 'hi' },
			{ role: 'assistant', content: 'ok', devFormatting: true, responseTimeSeconds: 3 },
		];
		const merged = mergeLocalExtras(server, local);
		assert.strictEqual(merged[1].responseTimeSeconds, 3);
		assert.strictEqual(merged[1].devFormatting, true);
		assert.strictEqual(merged[1].serverMessageId, 'a1');
	});

	test('mergeLocalExtras keeps local when server empty', () => {
		const local: IPolvoConversationMessage[] = [{ role: 'user', content: 'cached' }];
		const merged = mergeLocalExtras([], local);
		assert.strictEqual(merged.length, 1);
		assert.strictEqual(merged[0].content, 'cached');
	});

	test('reconcileMessageIds assigns server ids by role order', () => {
		const local: IPolvoConversationMessage[] = [
			{ role: 'user', content: 'q' },
			{ role: 'assistant', content: 'a' },
		];
		const next = reconcileMessageIds(local, [
			{ id: 'u1', role: 'user' },
			{ id: 'a1', role: 'assistant' },
		]);
		assert.strictEqual(next[0].serverMessageId, 'u1');
		assert.strictEqual(next[1].serverMessageId, 'a1');
	});
});
