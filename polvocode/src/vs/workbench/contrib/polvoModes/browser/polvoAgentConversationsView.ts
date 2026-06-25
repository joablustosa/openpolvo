/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { Action } from '../../../../base/common/actions.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { defaultButtonStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IPolvoAgentConversationsService } from './polvoAgentConversationsService.js';
import { PolvoAgentChatEditorInput } from './polvoAgentChatEditorInput.js';

const $ = dom.$;

export const POLVO_AGENT_CONVERSATIONS_VIEW_ID = 'polvo.agent.conversationsView';

export class PolvoAgentConversationsView extends ViewPane {

	private listContainer: HTMLElement | undefined;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IPolvoAgentConversationsService private readonly conversationsService: IPolvoAgentConversationsService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		container.classList.add('polvo-conversations-view');

		const header = dom.append(container, $('.polvo-conversations-header'));
		const newChatButton = this._register(new Button(header, { ...defaultButtonStyles, supportIcons: true, secondary: true }));
		newChatButton.label = `$(${Codicon.add.id}) ${localize('polvoNewChat', "Nova conversa")}`;
		newChatButton.element.classList.add('polvo-new-chat-button');
		this._register(newChatButton.onDidClick(() => void this.createNewConversation()));

		this.listContainer = dom.append(container, $('.polvo-conversations-list'));

		this._register(dom.addDisposableListener(this.listContainer, dom.EventType.CLICK, e => {
			const target = e.target as HTMLElement;
			const optionsBtn = target.closest('.polvo-conversation-options');
			if (optionsBtn instanceof HTMLElement) {
				e.preventDefault();
				e.stopPropagation();
				const conversationId = optionsBtn.dataset.conversationId;
				if (conversationId) {
					this.showConversationOptions(conversationId, e);
				}
				return;
			}
			const item = target.closest('.polvo-conversation-item');
			if (item instanceof HTMLElement) {
				const conversationId = item.dataset.conversationId;
				if (conversationId) {
					void this.openConversation(conversationId);
				}
			}
		}));

		this._register(this.conversationsService.onDidChangeConversations(() => this.renderList()));
		this._register(this.conversationsService.onDidChangeActiveConversation(() => this.renderList()));
		this._register(this.editorService.onDidActiveEditorChange(() => this.renderList()));
		this.renderList();
	}

	private renderList(): void {
		if (!this.listContainer) {
			return;
		}
		dom.clearNode(this.listContainer);

		const activeEditor = this.editorService.activeEditor;
		const activeConversationId = activeEditor instanceof PolvoAgentChatEditorInput
			? activeEditor.resource.path
			: this.conversationsService.activeConversationId;

		for (const conversation of this.conversationsService.conversations) {
			const item = dom.append(this.listContainer, $('.polvo-conversation-item'));
			item.dataset.conversationId = conversation.id;
			item.classList.toggle('active', conversation.id === activeConversationId);

			const icon = dom.append(item, $('.conversation-icon'));
			icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.commentDiscussion));

			const title = dom.append(item, $('.title'));
			title.textContent = conversation.title;

			const optionsButton = document.createElement('button');
			optionsButton.className = 'polvo-conversation-options';
			optionsButton.type = 'button';
			optionsButton.dataset.conversationId = conversation.id;
			optionsButton.title = localize('polvoConversationOptions', "Opções da conversa");
			optionsButton.setAttribute('aria-label', localize('polvoConversationOptions', "Opções da conversa"));
			optionsButton.appendChild(renderIcon(Codicon.ellipsis));
			item.appendChild(optionsButton);
		}
	}

	private showConversationOptions(conversationId: string, e: MouseEvent): void {
		this.contextMenuService.showContextMenu({
			getAnchor: () => ({ x: e.clientX, y: e.clientY }),
			getActions: () => [
				new Action(
					'polvo.agent.viewConversation',
					localize('polvoViewConversation', "Visualizar"),
					undefined,
					true,
					() => void this.openConversation(conversationId),
				),
				new Action(
					'polvo.agent.deleteConversation',
					localize('polvoDeleteConversation', "Excluir"),
					undefined,
					true,
					() => void this.deleteConversation(conversationId),
				),
			],
		});
	}

	private async createNewConversation(): Promise<void> {
		const conversation = this.conversationsService.createConversation();
		await this.openConversation(conversation.id);
	}

	private async openConversation(conversationId: string): Promise<void> {
		const conversation = this.conversationsService.getConversation(conversationId);
		if (!conversation) {
			return;
		}
		this.conversationsService.setActiveConversation(conversationId);
		await this.editorService.openEditor(new PolvoAgentChatEditorInput(conversation.resource), { pinned: true, revealIfOpened: true });
	}

	private async deleteConversation(conversationId: string): Promise<void> {
		const conversation = this.conversationsService.getConversation(conversationId);
		if (!conversation) {
			return;
		}
		const editors = this.editorService.findEditors(conversation.resource);
		if (editors.length > 0) {
			await this.editorService.closeEditors(editors);
		}
		this.conversationsService.deleteConversation(conversationId);
		const nextId = this.conversationsService.activeConversationId;
		if (nextId) {
			await this.openConversation(nextId);
		}
		this.renderList();
	}
}
