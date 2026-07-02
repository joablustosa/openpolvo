/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IPolvoAgentConversationsService } from './polvoAgentConversationsService.js';
import { PolvoAgentChatEditorInput } from './polvoAgentChatEditorInput.js';
import { IPolvoAgentChatContextService } from './polvoAgentChatContextService.js';

export const POLVO_AGENT_ATTACH_SELECTION_COMMAND = 'polvo.agent.attachSelection';

export async function openPolvoAgentChat(
	conversationsService: IPolvoAgentConversationsService,
	editorService: IEditorService,
): Promise<void> {
	let conversation = conversationsService.activeConversationId
		? conversationsService.getConversation(conversationsService.activeConversationId)
		: undefined;
	if (!conversation) {
		conversation = conversationsService.conversations[0];
	}
	if (!conversation) {
		conversation = conversationsService.createConversation();
	}
	conversationsService.setActiveConversation(conversation.id);
	await editorService.openEditor(
		new PolvoAgentChatEditorInput(conversation.resource),
		{ pinned: true, revealIfOpened: true },
	);
}

class AttachSelectionToPolvoChatAction extends Action2 {
	constructor() {
		super({
			id: POLVO_AGENT_ATTACH_SELECTION_COMMAND,
			title: localize2('polvoAttachSelection', "Adicionar seleção ao chat"),
			icon: Codicon.commentDiscussion,
			f1: false,
			menu: [{
				id: MenuId.EditorContext,
				group: '1_chat',
				order: 2,
				when: ContextKeyExpr.and(
					EditorContextKeys.hasNonEmptySelection,
				),
			}],
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const contextService = accessor.get(IPolvoAgentChatContextService);
		contextService.addFromEditorSelection();
		await openPolvoAgentChat(
			accessor.get(IPolvoAgentConversationsService),
			accessor.get(IEditorService),
		);
	}
}

registerAction2(AttachSelectionToPolvoChatAction);
