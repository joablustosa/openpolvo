/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MessageAttachment, MessageAttachmentKind } from '../../common/state/protocol/channels-chat/state.js';
import type { MessageResourceAttachment } from '../../common/state/protocol/channels-chat/state.js';

export interface IOpenPolvoRequestContext {
	workspace_folder?: string;
	selection?: {
		file?: string;
		path?: string;
		text?: string;
		content?: string;
		start_line?: number;
		end_line?: number;
	};
	open_files?: string[];
	attachments?: Array<{
		label: string;
		kind?: string;
		uri?: string;
		text?: string;
	}>;
}

export function buildOpenPolvoRequestContext(
	attachments: readonly MessageAttachment[] | undefined,
	workingDirectory?: string,
): IOpenPolvoRequestContext {
	const context: IOpenPolvoRequestContext = {};
	if (workingDirectory) {
		context.workspace_folder = workingDirectory;
	}

	const summarized: IOpenPolvoRequestContext['attachments'] = [];
	let selection: IOpenPolvoRequestContext['selection'];

	for (const attachment of attachments ?? []) {
		summarized.push({
			label: attachment.label,
			kind: attachment.displayKind,
			uri: getAttachmentUri(attachment),
			text: getAttachmentText(attachment),
		});

		if (!selection && attachment.displayKind === 'selection') {
			selection = {
				file: attachment.label,
				path: getAttachmentUri(attachment),
				text: getAttachmentText(attachment),
				...(getSelectionLines(attachment)),
			};
		} else if (!selection && attachment.type === MessageAttachmentKind.Resource) {
			const resource = attachment as MessageResourceAttachment;
			if (resource.selection?.range) {
				selection = {
					file: attachment.label,
					path: resource.uri?.toString(),
					start_line: resource.selection.range.start.line + 1,
					end_line: resource.selection.range.end.line + 1,
				};
			}
		}
	}

	if (summarized.length > 0) {
		context.attachments = summarized;
	}
	if (selection) {
		context.selection = selection;
	}

	return context;
}

function getAttachmentUri(attachment: MessageAttachment): string | undefined {
	if (attachment.type === MessageAttachmentKind.Resource) {
		return (attachment as MessageResourceAttachment).uri?.toString();
	}
	return undefined;
}

function getAttachmentText(attachment: MessageAttachment): string | undefined {
	if (attachment.type === MessageAttachmentKind.Simple) {
		return attachment.modelRepresentation;
	}
	return undefined;
}

function getSelectionLines(attachment: MessageAttachment): { start_line?: number; end_line?: number } {
	if (attachment.type === MessageAttachmentKind.Resource) {
		const resource = attachment as MessageResourceAttachment;
		if (resource.selection?.range) {
			return {
				start_line: resource.selection.range.start.line + 1,
				end_line: resource.selection.range.end.line + 1,
			};
		}
	}
	return {};
}
