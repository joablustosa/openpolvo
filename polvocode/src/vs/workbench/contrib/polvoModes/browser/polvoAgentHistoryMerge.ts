/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IPolvoCodeReferenceMeta } from './polvoAgentChatContextService.js';
import type { IPolvoConversationMessage } from './polvoAgentConversationsService.js';

export interface IServerMessageDTO {
	readonly id: string;
	readonly role: string;
	readonly content: string;
	readonly metadata?: unknown;
	readonly created_at?: string;
}

export interface IServerConversationDTO {
	readonly id: string;
	readonly title?: string;
	readonly default_model_provider?: string;
	readonly updated_at?: string;
	readonly created_at?: string;
}

function parseCodeReferences(metadata: unknown): IPolvoCodeReferenceMeta[] | undefined {
	if (!metadata || typeof metadata !== 'object') {
		return undefined;
	}
	const raw = (metadata as Record<string, unknown>).code_references;
	if (!Array.isArray(raw)) {
		return undefined;
	}
	const out: IPolvoCodeReferenceMeta[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const row = item as Record<string, unknown>;
		const path = String(row.path ?? '');
		if (!path) {
			continue;
		}
		out.push({
			path,
			startLine: Number(row.start_line ?? row.startLine ?? 1),
			endLine: Number(row.end_line ?? row.endLine ?? 1),
			preview: String(row.preview ?? row.text ?? '').slice(0, 200),
		});
	}
	return out.length > 0 ? out : undefined;
}

export function serverMessageToLocal(msg: IServerMessageDTO): IPolvoConversationMessage {
	const metadata = msg.metadata && typeof msg.metadata === 'object'
		? msg.metadata as Record<string, unknown>
		: undefined;
	return {
		role: msg.role === 'assistant' ? 'assistant' : 'user',
		content: msg.content ?? '',
		serverMessageId: msg.id,
		codeReferences: parseCodeReferences(metadata),
		metadata,
	};
}

export function mergeLocalExtras(
	serverMessages: IPolvoConversationMessage[],
	localMessages: IPolvoConversationMessage[],
): IPolvoConversationMessage[] {
	if (serverMessages.length === 0) {
		return localMessages;
	}
	if (localMessages.length === 0) {
		return serverMessages;
	}
	return serverMessages.map((serverMsg, index) => {
		const local = localMessages[index];
		if (!local || local.role !== serverMsg.role) {
			const byId = localMessages.find(m => m.serverMessageId && m.serverMessageId === serverMsg.serverMessageId);
			if (byId) {
				return mergeMessagePair(serverMsg, byId);
			}
			return serverMsg;
		}
		return mergeMessagePair(serverMsg, local);
	});
}

function mergeMessagePair(
	server: IPolvoConversationMessage,
	local: IPolvoConversationMessage,
): IPolvoConversationMessage {
	return {
		...server,
		pdfGenerating: local.pdfGenerating,
		pdfProgressLabel: local.pdfProgressLabel,
		richFormatting: local.richFormatting,
		richProgressLabel: local.richProgressLabel,
		devFormatting: local.devFormatting,
		devProgressLabel: local.devProgressLabel,
		devStepDone: local.devStepDone,
		devResponse: local.devResponse,
		devFileChanges: local.devFileChanges,
		responseTimeSeconds: local.responseTimeSeconds,
		attachments: local.attachments ?? server.attachments,
		codeReferences: local.codeReferences ?? server.codeReferences,
	};
}

export function reconcileMessageIds(
	localMessages: IPolvoConversationMessage[],
	saved: Array<{ id?: string; role?: string }>,
): IPolvoConversationMessage[] {
	if (!saved.length) {
		return localMessages;
	}
	const copy = localMessages.map(m => ({ ...m }));
	let userIdx = 0;
	let assistantIdx = 0;
	for (const row of saved) {
		if (!row.id) {
			continue;
		}
		if (row.role === 'user') {
			while (userIdx < copy.length && copy[userIdx].role !== 'user') {
				userIdx++;
			}
			if (userIdx < copy.length) {
				copy[userIdx].serverMessageId = row.id;
				userIdx++;
			}
		} else if (row.role === 'assistant') {
			while (assistantIdx < copy.length && copy[assistantIdx].role !== 'assistant') {
				assistantIdx++;
			}
			if (assistantIdx < copy.length) {
				copy[assistantIdx].serverMessageId = row.id;
				assistantIdx++;
			}
		}
	}
	return copy;
}
