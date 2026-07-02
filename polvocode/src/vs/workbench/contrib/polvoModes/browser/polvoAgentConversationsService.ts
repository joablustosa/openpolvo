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
import type { IPolvoCodeReferenceMeta } from './polvoAgentChatContextService.js';
import { mergeLocalExtras, reconcileMessageIds, serverMessageToLocal, type IServerConversationDTO, type IServerMessageDTO } from './polvoAgentHistoryMerge.js';

export interface IPolvoConversationSystemContext {
	global?: string;
	builder?: string;
}

export interface IPolvoConversation {
	readonly id: string;
	readonly resource: URI;
	title: string;
	readonly messages: IPolvoConversationMessage[];
	modelId: string;
	apiSessionId?: string;
	updatedAt?: string;
	systemContext?: IPolvoConversationSystemContext;
}

/** Metadados (sem conteúdo) de um anexo de mensagem — base64 nunca é persistido. */
export interface IPolvoMessageAttachment {
	readonly name: string;
	readonly mimeType: string;
	readonly sizeBytes: number;
}

export interface IPolvoDevFileChange {
	readonly path: string;
	readonly op?: 'write' | 'mkdir' | 'delete';
	readonly added?: number;
	readonly removed?: number;
}

export interface IPolvoConversationMessage {
	readonly role: 'user' | 'assistant';
	content: string;
	serverMessageId?: string;
	metadata?: Record<string, unknown>;
	attachments?: IPolvoMessageAttachment[];
	codeReferences?: IPolvoCodeReferenceMeta[];
	pdfGenerating?: boolean;
	pdfProgressLabel?: string;
	richFormatting?: boolean;
	richProgressLabel?: string;
	devFormatting?: boolean;
	devProgressLabel?: string;
	/** Passo do workflow concluído (card estático). */
	devStepDone?: boolean;
	/** Mensagem final com texto/resumo do assistente (separada dos passos). */
	devResponse?: boolean;
	devFileChanges?: IPolvoDevFileChange[];
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
	addMessage(conversationId: string, role: 'user' | 'assistant', content: string, attachments?: IPolvoMessageAttachment[], codeReferences?: IPolvoCodeReferenceMeta[]): void;
	setConversationModel(conversationId: string, modelId: string): void;
	setApiSessionId(conversationId: string, apiSessionId: string): void;
	updateAssistantMessage(conversationId: string, content: string, extras?: IPolvoAssistantMessageExtras): void;
	finalizeLastDevStep(conversationId: string): void;
	appendDevStepMessage(conversationId: string, label: string): void;
	updateDevResponseMessage(conversationId: string, content: string, extras?: IPolvoAssistantMessageExtras): void;
	deleteConversation(conversationId: string): boolean;
	upsertFromServer(server: IServerConversationDTO, messages: IServerMessageDTO[]): void;
	replaceMessages(conversationId: string, messages: IPolvoConversationMessage[]): void;
	reconcileServerMessageIds(conversationId: string, saved: Array<{ id?: string; role?: string }>): void;
	setSystemContext(conversationId: string, ctx: IPolvoConversationSystemContext | undefined): void;
	setConversationTitle(conversationId: string, title: string): void;
}

export interface IPolvoAssistantMessageExtras {
	metadata?: Record<string, unknown>;
	pdfGenerating?: boolean;
	pdfProgressLabel?: string;
	richFormatting?: boolean;
	richProgressLabel?: string;
	devFormatting?: boolean;
	devProgressLabel?: string;
	devStepDone?: boolean;
	devResponse?: boolean;
	devFileChanges?: IPolvoDevFileChange[];
	responseTimeSeconds?: number;
}

const STORAGE_KEY = 'polvo.agent.conversations';
const ACTIVE_CONVERSATION_KEY = 'polvo.agent.activeConversationId';
export const POLVO_AGENT_CHAT_SCHEME = 'polvo-agent-chat';

interface IStoredConversation {
	id: string;
	title: string;
	messages: IPolvoConversationMessage[];
	modelId?: string;
	apiSessionId?: string;
	updatedAt?: string;
	systemContext?: IPolvoConversationSystemContext;
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
		if (id) {
			this.storageService.store(ACTIVE_CONVERSATION_KEY, id, StorageScope.WORKSPACE, StorageTarget.USER);
		} else {
			this.storageService.remove(ACTIVE_CONVERSATION_KEY, StorageScope.WORKSPACE);
		}
		this._onDidChangeActiveConversation.fire(id);
	}

	getConversation(id: string): IPolvoConversation | undefined {
		return this._conversations.find(c => c.id === id);
	}

	addMessage(
		conversationId: string,
		role: 'user' | 'assistant',
		content: string,
		attachments?: IPolvoMessageAttachment[],
		codeReferences?: IPolvoCodeReferenceMeta[],
	): void {
		const conversation = this.getConversation(conversationId);
		if (!conversation) {
			return;
		}
		conversation.messages.push({
			role,
			content,
			attachments: attachments && attachments.length > 0 ? attachments : undefined,
			codeReferences: codeReferences && codeReferences.length > 0 ? codeReferences : undefined,
		});
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
		extras?: IPolvoAssistantMessageExtras,
	): void {
		const conversation = this.getConversation(conversationId);
		if (!conversation) {
			return;
		}
		const last = conversation.messages[conversation.messages.length - 1];
		if (last?.role === 'assistant' && !last.devResponse) {
			this._applyAssistantExtras(last, content, extras);
		} else {
			conversation.messages.push(this._newAssistantMessage(content, extras));
		}
		this.persist();
		this._onDidChangeConversations.fire();
	}

	finalizeLastDevStep(conversationId: string): void {
		const conversation = this.getConversation(conversationId);
		if (!conversation) {
			return;
		}
		for (let i = conversation.messages.length - 1; i >= 0; i--) {
			const msg = conversation.messages[i];
			if (msg.role === 'assistant' && msg.devFormatting && !msg.devStepDone) {
				msg.devFormatting = false;
				msg.devStepDone = true;
				this.persist();
				this._onDidChangeConversations.fire();
				return;
			}
		}
	}

	appendDevStepMessage(conversationId: string, label: string): void {
		const conversation = this.getConversation(conversationId);
		if (!conversation) {
			return;
		}
		this.finalizeLastDevStep(conversationId);
		conversation.messages.push({
			role: 'assistant',
			content: label,
			devFormatting: true,
			devProgressLabel: label,
		});
		this.persist();
		this._onDidChangeConversations.fire();
	}

	updateDevResponseMessage(
		conversationId: string,
		content: string,
		extras?: IPolvoAssistantMessageExtras,
	): void {
		const conversation = this.getConversation(conversationId);
		if (!conversation) {
			return;
		}
		let response = conversation.messages.findLast(m => m.role === 'assistant' && m.devResponse);
		if (!response) {
			this.finalizeLastDevStep(conversationId);
			response = this._newAssistantMessage(content, { ...extras, devResponse: true });
			conversation.messages.push(response);
		} else {
			this._applyAssistantExtras(response, content, { ...extras, devResponse: true });
		}
		this.persist();
		this._onDidChangeConversations.fire();
	}

	private _newAssistantMessage(content: string, extras?: IPolvoAssistantMessageExtras): IPolvoConversationMessage {
		return {
			role: 'assistant',
			content,
			metadata: extras?.metadata,
			pdfGenerating: extras?.pdfGenerating,
			pdfProgressLabel: extras?.pdfProgressLabel,
			richFormatting: extras?.richFormatting,
			richProgressLabel: extras?.richProgressLabel,
			devFormatting: extras?.devFormatting,
			devProgressLabel: extras?.devProgressLabel,
			devStepDone: extras?.devStepDone,
			devResponse: extras?.devResponse,
			devFileChanges: extras?.devFileChanges,
			responseTimeSeconds: extras?.responseTimeSeconds,
		};
	}

	private _applyAssistantExtras(
		last: IPolvoConversationMessage,
		content: string,
		extras?: IPolvoAssistantMessageExtras,
	): void {
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
		if (extras?.devFormatting !== undefined) {
			last.devFormatting = extras.devFormatting;
		}
		if (extras?.devProgressLabel !== undefined) {
			last.devProgressLabel = extras.devProgressLabel;
		}
		if (extras?.devStepDone !== undefined) {
			last.devStepDone = extras.devStepDone;
		}
		if (extras?.devResponse !== undefined) {
			last.devResponse = extras.devResponse;
		}
		if (extras?.devFileChanges !== undefined) {
			last.devFileChanges = extras.devFileChanges;
		}
		if (extras?.responseTimeSeconds !== undefined) {
			last.responseTimeSeconds = extras.responseTimeSeconds;
		}
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

	upsertFromServer(server: IServerConversationDTO, messages: IServerMessageDTO[]): void {
		const apiId = server.id;
		let conversation = this._conversations.find(c => c.apiSessionId === apiId);
		if (conversation) {
			if (messages.length > 0) {
				const serverLocal = messages.map(serverMessageToLocal);
				const merged = mergeLocalExtras(serverLocal, [...conversation.messages]);
				conversation.messages.length = 0;
				conversation.messages.push(...merged);
			}
			if (server.title?.trim()) {
				conversation.title = server.title.trim();
			}
			if (server.default_model_provider) {
				conversation.modelId = server.default_model_provider;
			}
			conversation.updatedAt = server.updated_at ?? server.created_at;
		} else {
			const id = generateUuid();
			const serverLocal = messages.map(serverMessageToLocal);
			conversation = {
				id,
				resource: URI.from({ scheme: POLVO_AGENT_CHAT_SCHEME, path: id }),
				title: server.title?.trim() || localize('polvoNewConversation', "Nova conversa"),
				messages: serverLocal,
				modelId: server.default_model_provider ?? 'polvo',
				apiSessionId: apiId,
				updatedAt: server.updated_at ?? server.created_at,
			};
			this._conversations.unshift(conversation);
		}
		this.persist();
		this._onDidChangeConversations.fire();
	}

	replaceMessages(conversationId: string, messages: IPolvoConversationMessage[]): void {
		const conversation = this.getConversation(conversationId);
		if (!conversation) {
			return;
		}
		conversation.messages.length = 0;
		conversation.messages.push(...messages);
		this.persist();
		this._onDidChangeConversations.fire();
	}

	reconcileServerMessageIds(conversationId: string, saved: Array<{ id?: string; role?: string }>): void {
		const conversation = this.getConversation(conversationId);
		if (!conversation) {
			return;
		}
		const next = reconcileMessageIds(conversation.messages, saved);
		conversation.messages.length = 0;
		conversation.messages.push(...next);
		this.persist();
		this._onDidChangeConversations.fire();
	}

	setSystemContext(conversationId: string, ctx: IPolvoConversationSystemContext | undefined): void {
		const conversation = this.getConversation(conversationId);
		if (!conversation) {
			return;
		}
		conversation.systemContext = ctx;
		this.persist();
		this._onDidChangeConversations.fire();
	}

	setConversationTitle(conversationId: string, title: string): void {
		const conversation = this.getConversation(conversationId);
		if (!conversation || !title.trim()) {
			return;
		}
		conversation.title = title.trim();
		this.persist();
		this._onDidChangeConversations.fire();
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
				updatedAt: item.updatedAt,
				systemContext: item.systemContext,
			}));
			const active = this.storageService.get(ACTIVE_CONVERSATION_KEY, StorageScope.WORKSPACE);
			this._activeConversationId = active && this._conversations.some(c => c.id === active)
				? active
				: this._conversations[0]?.id;
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
			updatedAt: c.updatedAt,
			systemContext: c.systemContext,
		}));
		this.storageService.store(STORAGE_KEY, JSON.stringify(stored), StorageScope.WORKSPACE, StorageTarget.USER);
	}
}

registerSingleton(IPolvoAgentConversationsService, PolvoAgentConversationsService, InstantiationType.Delayed);
