/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { localize } from '../../../../nls.js';

export interface IPolvoConversation {
	readonly id: string;
	readonly resource: URI;
	title: string;
	readonly messages: IPolvoConversationMessage[];
	modelId: string;
	apiSessionId?: string;
}

export interface IPolvoConversationMessage {
	readonly role: 'user' | 'assistant';
	content: string;
	metadata?: Record<string, unknown>;
	pdfGenerating?: boolean;
	pdfProgressLabel?: string;
	richFormatting?: boolean;
	richProgressLabel?: string;
	/** Tempo total da resposta em segundos (exibido após concluir). */
	responseTimeSeconds?: number;
}

export const IPolvoAgentConversationsService = createDecorator<IPolvoAgentConversationsService>('polvoAgentConversationsService');

export interface IPolvoAgentConversationsService {
	readonly _serviceBrand: undefined;

	readonly conversations: readonly IPolvoConversation[];
	readonly activeConversationId: string | undefined;
	readonly onDidChangeConversations: Event<void>;
	readonly onDidChangeActiveConversation: Event<string | undefined>;

	createConversation(): IPolvoConversation;
	setActiveConversation(id: string | undefined): void;
	getConversation(id: string): IPolvoConversation | undefined;
	addMessage(conversationId: string, role: 'user' | 'assistant', content: string): void;
	setConversationModel(conversationId: string, modelId: string): void;
	setApiSessionId(conversationId: string, apiSessionId: string): void;
	updateAssistantMessage(conversationId: string, content: string): void;
	deleteConversation(conversationId: string): boolean;
}

const STORAGE_KEY = 'polvo.agent.conversations';
export const POLVO_AGENT_CHAT_SCHEME = 'polvo-agent-chat';

interface IStoredConversation {
	id: string;
	title: string;
	messages: IPolvoConversationMessage[];
	modelId?: string;
	apiSessionId?: string;
}

export class PolvoAgentConversationsService extends Disposable implements IPolvoAgentConversationsService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeConversations = this._register(new Emitter<void>());
	readonly onDidChangeConversations = this._onDidChangeConversations.event;

	private readonly _onDidChangeActiveConversation = this._register(new Emitter<string | undefined>());
	readonly onDidChangeActiveConversation = this._onDidChangeActiveConversation.event;

	private _conversations: IPolvoConversation[] = [];
	private _activeConversationId: string | undefined;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
		this.restore();
		if (this._conversations.length === 0) {
			this.createConversation();
		}
	}

	get conversations(): readonly IPolvoConversation[] {
		return this._conversations;
	}

	get activeConversationId(): string | undefined {
		return this._activeConversationId;
	}

	createConversation(): IPolvoConversation {
		const id = generateUuid();
		const conversation: IPolvoConversation = {
			id,
			resource: URI.from({ scheme: POLVO_AGENT_CHAT_SCHEME, path: id }),
			title: localize('polvoNewConversation', "Nova conversa"),
			messages: [],
			modelId: 'polvo',
		};
		this._conversations.unshift(conversation);
		this._activeConversationId = id;
		this.persist();
		this._onDidChangeConversations.fire();
		this._onDidChangeActiveConversation.fire(id);
		return conversation;
	}

	setActiveConversation(id: string | undefined): void {
		if (this._activeConversationId === id) {
			return;
		}
		this._activeConversationId = id;
		this._onDidChangeActiveConversation.fire(id);
	}

	getConversation(id: string): IPolvoConversation | undefined {
		return this._conversations.find(c => c.id === id);
	}

	addMessage(conversationId: string, role: 'user' | 'assistant', content: string): void {
		const conversation = this.getConversation(conversationId);
		if (!conversation) {
			return;
		}
		conversation.messages.push({ role, content });
		if (role === 'user' && conversation.title === localize('polvoNewConversation', "Nova conversa")) {
			conversation.title = content.length > 40 ? `${content.slice(0, 40)}…` : content;
		}
		this.persist();
		this._onDidChangeConversations.fire();
	}

	setConversationModel(conversationId: string, modelId: string): void {
		const conversation = this.getConversation(conversationId);
		if (!conversation || conversation.modelId === modelId) {
			return;
		}
		conversation.modelId = modelId;
		this.persist();
		this._onDidChangeConversations.fire();
	}

	setApiSessionId(conversationId: string, apiSessionId: string): void {
		const conversation = this.getConversation(conversationId);
		if (!conversation) {
			return;
		}
		conversation.apiSessionId = apiSessionId;
		this.persist();
	}

	updateAssistantMessage(
		conversationId: string,
		content: string,
		extras?: {
			metadata?: Record<string, unknown>;
			pdfGenerating?: boolean;
			pdfProgressLabel?: string;
			richFormatting?: boolean;
			richProgressLabel?: string;
			responseTimeSeconds?: number;
		},
	): void {
		const conversation = this.getConversation(conversationId);
		if (!conversation) {
			return;
		}
		const last = conversation.messages[conversation.messages.length - 1];
		if (last?.role === 'assistant') {
			last.content = content;
			if (extras?.metadata !== undefined) {
				last.metadata = extras.metadata;
			}
			if (extras?.pdfGenerating !== undefined) {
				last.pdfGenerating = extras.pdfGenerating;
			}
			if (extras?.pdfProgressLabel !== undefined) {
				last.pdfProgressLabel = extras.pdfProgressLabel;
			}
			if (extras?.richFormatting !== undefined) {
				last.richFormatting = extras.richFormatting;
			}
			if (extras?.richProgressLabel !== undefined) {
				last.richProgressLabel = extras.richProgressLabel;
			}
			if (extras?.responseTimeSeconds !== undefined) {
				last.responseTimeSeconds = extras.responseTimeSeconds;
			}
		} else {
			conversation.messages.push({
				role: 'assistant',
				content,
				metadata: extras?.metadata,
				pdfGenerating: extras?.pdfGenerating,
				pdfProgressLabel: extras?.pdfProgressLabel,
				richFormatting: extras?.richFormatting,
				richProgressLabel: extras?.richProgressLabel,
				responseTimeSeconds: extras?.responseTimeSeconds,
			});
		}
		this.persist();
		this._onDidChangeConversations.fire();
	}

	deleteConversation(conversationId: string): boolean {
		const index = this._conversations.findIndex(c => c.id === conversationId);
		if (index === -1) {
			return false;
		}
		this._conversations.splice(index, 1);
		if (this._activeConversationId === conversationId) {
			if (this._conversations.length === 0) {
				this.createConversation();
			} else {
				this._activeConversationId = this._conversations[0]?.id;
				this._onDidChangeActiveConversation.fire(this._activeConversationId);
			}
		}
		this.persist();
		this._onDidChangeConversations.fire();
		return true;
	}

	private restore(): void {
		const raw = this.storageService.get(STORAGE_KEY, StorageScope.WORKSPACE);
		if (!raw) {
			return;
		}
		try {
			const stored = JSON.parse(raw) as IStoredConversation[];
			this._conversations = stored.map(item => ({
				id: item.id,
				resource: URI.from({ scheme: POLVO_AGENT_CHAT_SCHEME, path: item.id }),
				title: item.title,
				messages: item.messages,
				modelId: item.modelId ?? 'polvo',
				apiSessionId: item.apiSessionId,
			}));
			this._activeConversationId = this._conversations[0]?.id;
		} catch {
			this._conversations = [];
		}
	}

	private persist(): void {
		const stored: IStoredConversation[] = this._conversations.map(c => ({
			id: c.id,
			title: c.title,
			messages: c.messages,
			modelId: c.modelId,
			apiSessionId: c.apiSessionId,
		}));
		this.storageService.store(STORAGE_KEY, JSON.stringify(stored), StorageScope.WORKSPACE, StorageTarget.USER);
	}
}

registerSingleton(IPolvoAgentConversationsService, PolvoAgentConversationsService, InstantiationType.Delayed);
