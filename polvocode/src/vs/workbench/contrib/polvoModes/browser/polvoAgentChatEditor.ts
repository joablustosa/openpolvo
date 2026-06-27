/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { Dimension } from '../../../../base/browser/dom.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { Action } from '../../../../base/common/actions.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { PolvoAgentChatEditorInput } from './polvoAgentChatEditorInput.js';
import { IPolvoAgentConversationsService, type IPolvoConversationMessage, type IPolvoMessageAttachment } from './polvoAgentConversationsService.js';
import { IOpenPolvoModel, IOpenPolvoWorkbenchApiService, type IOpenPolvoStreamEvent } from './openPolvoWorkbenchApiService.js';
import type { IOpenPolvoAttachment } from '../../../../platform/agentHost/common/openpolvoBackendProtocol.js';
import { IOpenPolvoSignInService } from './openPolvoAuth.js';
import { withOpenPolvoApiAuth } from './openPolvoApiAuthHelper.js';
import { extractRichBlocks, markdownToRichBlocks, renderRichChatBlocks } from './polvoRichChatRenderer.js';
import {
	appendResponseTimerLabel,
	isAssistantResponseLoading,
	PolvoChatResponseTimerController,
	renderLoadingPlaceholder,
} from './polvoChatResponseTimer.js';

const $ = dom.$;

interface IQuickAction {
	readonly icon: ThemeIcon;
	readonly label: string;
	readonly prompt: string;
}

export class PolvoAgentChatEditor extends EditorPane {
	static readonly ID = PolvoAgentChatEditorInput.EditorID;

	private static readonly MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

	private container: HTMLElement | undefined;
	private messagesInner: HTMLElement | undefined;
	private inputElement: HTMLTextAreaElement | undefined;
	private fileInput: HTMLInputElement | undefined;
	private attachmentsRow: HTMLElement | undefined;
	private pendingAttachments: File[] = [];
	private modelLabelElement: HTMLElement | undefined;
	private modelChip: HTMLButtonElement | undefined;
	private sendButton: HTMLButtonElement | undefined;
	private conversationId: string | undefined;
	private models: IOpenPolvoModel[] = [];
	private isSending = false;
	private abortController: AbortController | undefined;
	private readonly responseTimer = new PolvoChatResponseTimerController(() => this.renderMessages());

	private readonly quickActions: IQuickAction[] = [
		{ icon: Codicon.code, label: localize('polvoQuickCode', "Código"), prompt: localize('polvoQuickCodePrompt', "Ajude-me com o código selecionado no workspace.") },
		{ icon: Codicon.edit, label: localize('polvoQuickWrite', "Escrever"), prompt: localize('polvoQuickWritePrompt', "Escreva um texto claro e objetivo sobre o assunto que eu descrever.") },
		{ icon: Codicon.lightbulb, label: localize('polvoQuickPlan', "Planejar"), prompt: localize('polvoQuickPlanPrompt', "Planeje os passos para implementar a tarefa que vou descrever.") },
		{ icon: Codicon.terminal, label: localize('polvoQuickTerminal', "Terminal"), prompt: localize('polvoQuickTerminalPrompt', "Sugira comandos de terminal para executar a tarefa no projeto.") },
	];

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IPolvoAgentConversationsService private readonly conversationsService: IPolvoAgentConversationsService,
		@IOpenPolvoWorkbenchApiService private readonly openPolvoApi: IOpenPolvoWorkbenchApiService,
		@IOpenPolvoSignInService private readonly signInService: IOpenPolvoSignInService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
	) {
		super(PolvoAgentChatEditor.ID, group, telemetryService, themeService, storageService);
		this._register(this.responseTimer);
	}

	protected createEditor(parent: HTMLElement): void {
		this.container = dom.append(parent, $('.polvo-agent-chat-editor'));

		const messagesArea = dom.append(this.container, $('.polvo-agent-chat-messages'));
		this.messagesInner = dom.append(messagesArea, $('.polvo-agent-chat-messages-inner'));

		const composer = dom.append(this.container, $('.polvo-agent-chat-composer'));
		const composerInner = dom.append(composer, $('.polvo-agent-chat-composer-inner'));

		const composerBox = dom.append(composerInner, $('.polvo-agent-chat-composer-box'));

		this.attachmentsRow = dom.append(composerBox, $('.polvo-agent-chat-attachments'));
		this.attachmentsRow.style.display = 'none';

		this.inputElement = document.createElement('textarea');
		this.inputElement.className = 'polvo-agent-chat-input';
		this.inputElement.placeholder = localize('polvoAgentChatPlaceholder', "Como posso ajudar você hoje?");
		this.inputElement.rows = 3;
		composerBox.appendChild(this.inputElement);

		this.fileInput = document.createElement('input');
		this.fileInput.type = 'file';
		this.fileInput.accept = '.pdf,application/pdf,.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,.doc,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword';
		this.fileInput.multiple = true;
		this.fileInput.hidden = true;
		composerBox.appendChild(this.fileInput);
		this._register(dom.addDisposableListener(this.fileInput, dom.EventType.CHANGE, () => this.onFilesPicked()));

		const composerFooter = dom.append(composerBox, $('.polvo-agent-chat-composer-footer'));

		const attachButton = document.createElement('button');
		attachButton.className = 'polvo-agent-chat-icon-button';
		attachButton.type = 'button';
		attachButton.title = localize('polvoAgentAttachFile', "Anexar ficheiro");
		attachButton.appendChild(renderIcon(Codicon.add));
		attachButton.setAttribute('aria-label', localize('polvoAgentAttachPdf', "Anexar PDF"));
		composerFooter.appendChild(attachButton);

		const footerRight = dom.append(composerFooter, $('.polvo-agent-chat-composer-footer-right'));

		this.modelChip = document.createElement('button');
		this.modelChip.className = 'polvo-agent-chat-model-chip';
		this.modelChip.type = 'button';
		this.modelChip.title = localize('polvoAgentModel', "Modelo");
		this.modelLabelElement = dom.append(this.modelChip, $('span.polvo-agent-chat-model-label'));
		this.modelLabelElement.textContent = localize('polvoAgentLoadingModels', "Carregando...");
		this.modelChip.appendChild(renderIcon(Codicon.chevronDown));
		footerRight.appendChild(this.modelChip);

		this.sendButton = document.createElement('button');
		this.sendButton.className = 'polvo-agent-chat-send-button';
		this.sendButton.type = 'button';
		this.sendButton.title = localize('polvoAgentSend', "Enviar");
		this.sendButton.setAttribute('aria-label', localize('polvoAgentSend', "Enviar"));
		this.sendButton.appendChild(renderIcon(Codicon.arrowUp));
		footerRight.appendChild(this.sendButton);

		this._register(dom.addDisposableListener(this.sendButton, dom.EventType.CLICK, () => this.sendMessage()));
		this._register(dom.addDisposableListener(attachButton, dom.EventType.CLICK, () => this.fileInput?.click()));
		this._register(dom.addDisposableListener(this.modelChip, dom.EventType.CLICK, e => this.showModelPicker(e)));

		const quickActionsRow = dom.append(composerInner, $('.polvo-agent-chat-quick-actions'));
		for (const action of this.quickActions) {
			const pill = document.createElement('button');
			pill.className = 'polvo-agent-chat-quick-action';
			pill.type = 'button';
			pill.appendChild(renderIcon(action.icon));
			pill.appendChild(document.createTextNode(action.label));
			quickActionsRow.appendChild(pill);
			this._register(dom.addDisposableListener(pill, dom.EventType.CLICK, () => {
				if (this.inputElement) {
					this.inputElement.value = action.prompt;
					this.inputElement.focus();
				}
			}));
		}

		this._register(dom.addDisposableListener(this.inputElement, dom.EventType.INPUT, () => this.autoResizeInput()));
		this._register(dom.addDisposableListener(this.inputElement, dom.EventType.KEY_DOWN, e => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				void this.sendMessage();
			}
		}));

		this._register(this.conversationsService.onDidChangeConversations(() => {
			this.renderMessages();
			this.updateModelLabel();
		}));
		this._register(this.conversationsService.onDidChangeActiveConversation(() => this.renderMessages()));

		void this.loadModels();
	}

	override async setInput(input: PolvoAgentChatEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this.conversationId = input.resource.path;
		this.conversationsService.setActiveConversation(this.conversationId);
		await this.signInService.ensureSignedIn();
		await this.ensureApiSession();
		this.updateModelLabel();
		this.renderMessages();
		this.autoResizeInput();
		this.inputElement?.focus();
	}

	override layout(dimension: Dimension): void {
		if (this.container) {
			this.container.style.width = `${dimension.width}px`;
			this.container.style.height = `${dimension.height}px`;
		}
	}

	private async loadModels(): Promise<void> {
		this.models = await withOpenPolvoApiAuth(this.signInService, () => this.openPolvoApi.listModels());
		this.updateModelLabel();
	}

	private updateModelLabel(): void {
		if (!this.modelLabelElement || !this.conversationId) {
			return;
		}
		const conversation = this.conversationsService.getConversation(this.conversationId);
		const modelId = conversation?.modelId ?? 'polvo';
		const model = this.models.find(m => m.id === modelId) ?? this.models[0];
		this.modelLabelElement.textContent = model?.name ?? localize('polvoAgentDefaultModel', "Polvo");
	}

	private showModelPicker(e: MouseEvent): void {
		if (this.models.length === 0) {
			void this.loadModels().then(() => this.showModelPicker(e));
			return;
		}
		const conversation = this.conversationId ? this.conversationsService.getConversation(this.conversationId) : undefined;
		const selectedId = conversation?.modelId;
		this.contextMenuService.showContextMenu({
			getAnchor: () => ({ x: e.clientX, y: e.clientY }),
			getActions: () => this.models.map(model => {
				const action = new Action(
					`polvo-model-${model.id}`,
					model.name,
					undefined,
					true,
					() => {
						if (this.conversationId) {
							this.conversationsService.setConversationModel(this.conversationId, model.id);
							this.updateModelLabel();
						}
					},
				);
				action.checked = model.id === selectedId;
				return action;
			}),
		});
	}

	private async ensureApiSession(): Promise<void> {
		if (!this.conversationId) {
			return;
		}
		const conversation = this.conversationsService.getConversation(this.conversationId);
		if (!conversation || conversation.apiSessionId) {
			return;
		}
		try {
			const apiSessionId = await withOpenPolvoApiAuth(this.signInService, () =>
				this.openPolvoApi.createSession(conversation.title, conversation.modelId)
			);
			this.conversationsService.setApiSessionId(this.conversationId, apiSessionId);
		} catch {
			// A sessão será criada na primeira mensagem.
		}
	}

	private setSending(sending: boolean): void {
		this.isSending = sending;
		if (this.sendButton) {
			this.sendButton.disabled = sending;
		}
		if (this.inputElement) {
			this.inputElement.disabled = sending;
		}
	}

	private async sendMessage(): Promise<void> {
		if (!this.inputElement || !this.conversationId || this.isSending) {
			return;
		}
		const rawText = this.inputElement.value.trim();
		const files = [...this.pendingAttachments];
		if (!rawText && files.length === 0) {
			return;
		}

		const conversation = this.conversationsService.getConversation(this.conversationId);
		if (!conversation) {
			return;
		}

		let attachments: IOpenPolvoAttachment[] = [];
		try {
			attachments = await Promise.all(files.map(f => this.fileToAttachment(f)));
		} catch {
			this.conversationsService.addMessage(
				this.conversationId,
				'assistant',
				localize('polvoAttachReadError', "Não foi possível ler um dos ficheiros anexados."),
			);
			this.renderMessages();
			return;
		}

		// O agente de leitura precisa de um pedido; se o utilizador só anexou o PDF, assume análise.
		const text = rawText || localize('polvoAttachDefaultPrompt', "Analise este documento e faça um resumo.");
		const attachmentMeta: IPolvoMessageAttachment[] = files.map(f => ({
			name: f.name,
			mimeType: f.type || 'application/pdf',
			sizeBytes: f.size,
		}));

		this.conversationsService.addMessage(this.conversationId, 'user', text, attachmentMeta);
		this.inputElement.value = '';
		this.clearPendingAttachments();
		this.autoResizeInput();
		this.renderMessages();

		this.setSending(true);
		this.responseTimer.start();
		this.abortController?.abort();
		this.abortController = new AbortController();

		let apiSessionId = conversation.apiSessionId;
		try {
			await withOpenPolvoApiAuth(this.signInService, async () => {
				if (!apiSessionId) {
					apiSessionId = await this.openPolvoApi.createSession(conversation.title, conversation.modelId);
					this.conversationsService.setApiSessionId(this.conversationId!, apiSessionId);
				}

				this.conversationsService.addMessage(this.conversationId!, 'assistant', '');
				this.renderMessages();

				let assistantText = '';
				let assistantMetadata: Record<string, unknown> | undefined;
				let pdfGenerating = false;
				let pdfProgressLabel = '';
				let richFormatting = false;
				let richProgressLabel = '';

				const handleStreamEvent = (event: IOpenPolvoStreamEvent): void => {
				if (event.type === 'text_delta' && event.delta) {
					assistantText += event.delta;
					this.conversationsService.updateAssistantMessage(this.conversationId!, assistantText, {
						pdfGenerating,
						pdfProgressLabel,
						richFormatting,
						richProgressLabel,
						metadata: assistantMetadata,
					});
					this.renderMessages();
				} else if (event.type === 'progress') {
					const step = String(event.payload?.step ?? '');
					if (step.startsWith('doc_') || event.payload?.document_kind === 'docx_result' || event.payload?.document_kind === 'doc_read_result') {
						richFormatting = true;
						richProgressLabel = event.content ?? event.payload?.label as string ?? '';
						this.conversationsService.updateAssistantMessage(
							this.conversationId!,
							richProgressLabel,
							{ richFormatting: true, richProgressLabel, pdfGenerating: false, metadata: assistantMetadata },
						);
						this.renderMessages();
					} else if (step.startsWith('xlsx_') || event.payload?.document_kind === 'xlsx_result' || event.payload?.document_kind === 'xlsx_read_result') {
						richFormatting = true;
						richProgressLabel = event.content ?? event.payload?.label as string ?? '';
						this.conversationsService.updateAssistantMessage(
							this.conversationId!,
							richProgressLabel,
							{ richFormatting: true, richProgressLabel, pdfGenerating: false, metadata: assistantMetadata },
						);
						this.renderMessages();
					} else if (step.startsWith('pdf_read') || event.payload?.document_kind === 'pdf_read_result') {
						richFormatting = true;
						richProgressLabel = event.content ?? event.payload?.label as string ?? '';
						this.conversationsService.updateAssistantMessage(
							this.conversationId!,
							richProgressLabel,
							{ richFormatting: true, richProgressLabel, pdfGenerating: false, metadata: assistantMetadata },
						);
						this.renderMessages();
					} else if (step.startsWith('pdf_') || event.payload?.document_kind === 'pdf_study_report') {
						pdfGenerating = true;
						pdfProgressLabel = event.content ?? event.payload?.label as string ?? '';
						this.conversationsService.updateAssistantMessage(
							this.conversationId!,
							assistantText || pdfProgressLabel,
							{ pdfGenerating: true, pdfProgressLabel, richFormatting: false, metadata: assistantMetadata },
						);
						this.renderMessages();
					} else if (step.startsWith('conv_') || event.payload?.conversation_format === 'rich_blocks') {
						richFormatting = true;
						richProgressLabel = event.content ?? event.payload?.label as string ?? '';
						this.conversationsService.updateAssistantMessage(
							this.conversationId!,
							richProgressLabel,
							{ richFormatting: true, richProgressLabel, pdfGenerating: false, metadata: assistantMetadata },
						);
						this.renderMessages();
					} else if (event.content && !assistantText) {
						this.conversationsService.updateAssistantMessage(this.conversationId!, event.content, {
							pdfGenerating,
							pdfProgressLabel,
						});
						this.renderMessages();
					}
				} else if (event.type === 'error') {
					const errorMessage = event.error ?? localize('polvoAgentUnknownError', "Erro desconhecido");
					this.conversationsService.updateAssistantMessage(this.conversationId!, errorMessage, {
						pdfGenerating: false,
					});
					this.renderMessages();
				} else if (event.type === 'thinking' && event.content && !assistantText) {
					this.conversationsService.updateAssistantMessage(this.conversationId!, event.content, {
						pdfGenerating,
						pdfProgressLabel,
					});
					this.renderMessages();
				} else if (event.type === 'done') {
					if (event.content) {
						assistantText = event.content;
					}
					if (event.metadata) {
						assistantMetadata = event.metadata;
					}
					pdfGenerating = false;
					richFormatting = false;
					this.conversationsService.updateAssistantMessage(this.conversationId!, assistantText, {
						metadata: assistantMetadata,
						pdfGenerating: false,
						richFormatting: false,
					});
					this.renderMessages();
				}
			};

			await this.openPolvoApi.streamMessage(
				apiSessionId!,
				text,
				conversation.modelId,
				handleStreamEvent,
				this.abortController.signal,
				attachments,
			);

			if (!assistantText) {
				const last = this.conversationsService.getConversation(this.conversationId!)?.messages.at(-1);
				if (last?.role === 'assistant' && !last.content) {
					this.conversationsService.updateAssistantMessage(
						this.conversationId!,
						localize('polvoAgentEmptyResponse', "Sem resposta do servidor.")
					);
					this.renderMessages();
				}
			}
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.conversationsService.addMessage(
				this.conversationId,
				'assistant',
				localize('polvoAgentApiError', "Não foi possível contactar a API OpenPolvo: {0}", message)
			);
			this.renderMessages();
		} finally {
			const responseTimeSeconds = this.responseTimer.stop();
			if (responseTimeSeconds !== undefined && this.conversationId) {
				const conversation = this.conversationsService.getConversation(this.conversationId);
				const last = conversation?.messages.at(-1);
				if (last?.role === 'assistant') {
					this.conversationsService.updateAssistantMessage(this.conversationId, last.content, {
						metadata: last.metadata,
						pdfGenerating: last.pdfGenerating,
						pdfProgressLabel: last.pdfProgressLabel,
						richFormatting: last.richFormatting,
						richProgressLabel: last.richProgressLabel,
						responseTimeSeconds,
					});
					this.renderMessages();
				}
			}
			this.setSending(false);
		}
	}

	private onFilesPicked(): void {
		if (!this.fileInput?.files) {
			return;
		}
		for (const file of Array.from(this.fileInput.files)) {
			if (!PolvoAgentChatEditor.isSupportedAttachment(file)) {
				continue;
			}
			if (file.size > PolvoAgentChatEditor.MAX_ATTACHMENT_BYTES) {
				this.conversationsService.addMessage(
					this.conversationId!,
					'assistant',
					localize('polvoAttachTooLarge', "O ficheiro \"{0}\" excede o limite de 8 MB.", file.name),
				);
				this.renderMessages();
				continue;
			}
			if (!this.pendingAttachments.some(f => f.name === file.name && f.size === file.size)) {
				this.pendingAttachments.push(file);
			}
		}
		this.fileInput.value = '';
		this.renderAttachmentChips();
	}

	private static isSupportedAttachment(file: { name: string; type: string }): boolean {
		const name = file.name.toLowerCase();
		const type = (file.type || '').toLowerCase();
		const isPdf = type === 'application/pdf' || name.endsWith('.pdf');
		const isSheet =
			type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
			type === 'application/vnd.ms-excel' ||
			type.includes('csv') ||
			name.endsWith('.xlsx') ||
			name.endsWith('.xls') ||
			name.endsWith('.csv');
		const isWord =
			type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
			type === 'application/msword' ||
			name.endsWith('.docx') ||
			name.endsWith('.doc');
		return isPdf || isSheet || isWord;
	}

	private static isWordAttachment(name: string, mimeType?: string): boolean {
		const n = (name || '').toLowerCase();
		const m = (mimeType || '').toLowerCase();
		return (
			n.endsWith('.docx') ||
			n.endsWith('.doc') ||
			m.includes('wordprocessingml') ||
			m === 'application/msword'
		);
	}

	private static iconForAttachment(name: string, mimeType?: string): Codicon {
		const n = (name || '').toLowerCase();
		const m = (mimeType || '').toLowerCase();
		if (PolvoAgentChatEditor.isWordAttachment(name, mimeType)) {
			return Codicon.fileText;
		}
		if (n.endsWith('.csv') || n.endsWith('.xlsx') || n.endsWith('.xls') || m.includes('csv') || m.includes('spreadsheet') || m.includes('ms-excel')) {
			return Codicon.table;
		}
		return Codicon.filePdf;
	}

	private removePendingAttachment(file: File): void {
		this.pendingAttachments = this.pendingAttachments.filter(f => f !== file);
		this.renderAttachmentChips();
	}

	private clearPendingAttachments(): void {
		this.pendingAttachments = [];
		this.renderAttachmentChips();
	}

	private renderAttachmentChips(): void {
		if (!this.attachmentsRow) {
			return;
		}
		dom.clearNode(this.attachmentsRow);
		if (this.pendingAttachments.length === 0) {
			this.attachmentsRow.style.display = 'none';
			return;
		}
		this.attachmentsRow.style.display = 'flex';
		for (const file of this.pendingAttachments) {
			const chip = dom.append(this.attachmentsRow, $('.polvo-agent-chat-attachment-chip'));
			chip.appendChild(renderIcon(PolvoAgentChatEditor.iconForAttachment(file.name, file.type)));
			const name = dom.append(chip, $('span.polvo-agent-chat-attachment-name'));
			name.textContent = file.name;
			const size = dom.append(chip, $('span.polvo-agent-chat-attachment-size'));
			size.textContent = this.formatBytes(file.size);
			const remove = document.createElement('button');
			remove.type = 'button';
			remove.className = 'polvo-agent-chat-attachment-remove';
			remove.title = localize('polvoAttachRemove', "Remover anexo");
			remove.appendChild(renderIcon(Codicon.close));
			this._register(dom.addDisposableListener(remove, dom.EventType.CLICK, () => this.removePendingAttachment(file)));
			chip.appendChild(remove);
		}
	}

	private formatBytes(bytes: number): string {
		if (bytes >= 1024 * 1024) {
			return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		}
		return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	}

	private fileToAttachment(file: File): Promise<IOpenPolvoAttachment> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onerror = () => reject(reader.error ?? new Error('read error'));
			reader.onload = () => {
				const result = String(reader.result ?? '');
				const base64 = result.includes(',') ? result.slice(result.indexOf(',') + 1) : result;
				resolve({ name: file.name, mime_type: file.type || PolvoAgentChatEditor.inferMimeType(file.name), data_base64: base64 });
			};
			reader.readAsDataURL(file);
		});
	}

	private static inferMimeType(name: string): string {
		const n = (name || '').toLowerCase();
		if (n.endsWith('.xlsx')) {
			return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
		}
		if (n.endsWith('.csv')) {
			return 'text/csv';
		}
		if (n.endsWith('.docx')) {
			return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
		}
		if (n.endsWith('.doc')) {
			return 'application/msword';
		}
		return 'application/pdf';
	}

	private autoResizeInput(): void {
		if (!this.inputElement) {
			return;
		}
		this.inputElement.style.height = 'auto';
		const next = Math.min(this.inputElement.scrollHeight, 200);
		this.inputElement.style.height = `${Math.max(next, 72)}px`;
	}

	private renderMessages(): void {
		if (!this.messagesInner || !this.conversationId) {
			return;
		}
		dom.clearNode(this.messagesInner);

		const conversation = this.conversationsService.getConversation(this.conversationId);
		if (!conversation || conversation.messages.length === 0) {
			return;
		}

		for (let i = 0; i < conversation.messages.length; i++) {
			const message = conversation.messages[i];
			const isLast = i === conversation.messages.length - 1;
			const isLoading = isAssistantResponseLoading(message, isLast, this.isSending);
			if (isLoading && !this.responseTimer.isRunning()) {
				this.responseTimer.start();
			}

			const messageEl = dom.append(this.messagesInner, $('.polvo-agent-chat-message'));
			messageEl.classList.add(message.role);
			const bubble = dom.append(messageEl, $('.polvo-agent-chat-bubble'));
			if (message.role === 'assistant') {
				const elapsed = isLoading ? this.responseTimer.getElapsedSeconds() : message.responseTimeSeconds;
				this.renderAssistantBubble(bubble, message, isLoading, elapsed);
				if (elapsed !== undefined) {
					appendResponseTimerLabel(messageEl, elapsed, isLoading);
				}
			} else {
				this.renderUserBubble(bubble, message);
			}
		}

		this.messagesInner.parentElement?.scrollTo({ top: this.messagesInner.parentElement.scrollHeight });
	}

	private renderUserBubble(bubble: HTMLElement, message: IPolvoConversationMessage): void {
		if (message.attachments && message.attachments.length > 0) {
			const row = dom.append(bubble, $('.polvo-agent-chat-message-attachments'));
			for (const att of message.attachments) {
				const chip = dom.append(row, $('.polvo-agent-chat-attachment-chip.is-sent'));
				chip.appendChild(renderIcon(PolvoAgentChatEditor.iconForAttachment(att.name, att.mimeType)));
				const name = dom.append(chip, $('span.polvo-agent-chat-attachment-name'));
				name.textContent = att.name;
				const size = dom.append(chip, $('span.polvo-agent-chat-attachment-size'));
				size.textContent = this.formatBytes(att.sizeBytes);
			}
		}
		if (message.content) {
			const textEl = dom.append(bubble, $('.polvo-agent-chat-text'));
			textEl.textContent = message.content;
		}
	}

	private renderAssistantBubble(
		bubble: HTMLElement,
		message: IPolvoConversationMessage,
		isLoading: boolean,
		elapsedSeconds?: number,
	): void {
		if (isLoading && !message.content && !message.pdfGenerating && !message.richFormatting) {
			renderLoadingPlaceholder(bubble, elapsedSeconds ?? 0);
			return;
		}
		if (message.pdfGenerating) {
			this.renderPdfGeneratingCard(bubble, message.pdfProgressLabel);
			return;
		}
		if (message.richFormatting) {
			this.renderRichFormattingCard(bubble, message.richProgressLabel);
			return;
		}
		const richBlocks = extractRichBlocks(message.metadata);
		if (richBlocks.length > 0) {
			const richHost = dom.append(bubble, $('.polvo-agent-chat-rich'));
			renderRichChatBlocks(richHost, richBlocks);
		} else if (message.content) {
			const fallbackBlocks = markdownToRichBlocks(message.content);
			if (fallbackBlocks.length > 0) {
				const richHost = dom.append(bubble, $('.polvo-agent-chat-rich'));
				renderRichChatBlocks(richHost, fallbackBlocks);
			} else {
				const textEl = dom.append(bubble, $('.polvo-agent-chat-text'));
				textEl.textContent = message.content;
			}
		}
		const meta = message.metadata;
		if (meta && typeof meta.pdf_document_base64 === 'string' && meta.pdf_document_base64) {
			this.renderPdfDownloadCard(
				bubble,
				String(meta.pdf_export_suggested_filename ?? 'documento.pdf'),
				meta.pdf_document_base64,
				typeof meta.pdf_size_bytes === 'number' ? meta.pdf_size_bytes : undefined,
			);
		}
		if (meta && meta.document_kind === 'pdf_read_result') {
			this.renderPdfReadBadge(bubble, meta.pdf_read as Record<string, unknown> | undefined);
		}
		if (meta && typeof meta.xlsx_document_base64 === 'string' && meta.xlsx_document_base64) {
			this.renderXlsxDownloadCard(
				bubble,
				String(meta.xlsx_export_suggested_filename ?? 'planilha.xlsx'),
				meta.xlsx_document_base64,
				typeof meta.xlsx_size_bytes === 'number' ? meta.xlsx_size_bytes : undefined,
			);
		}
		if (meta && meta.document_kind === 'xlsx_read_result') {
			this.renderXlsxReadBadge(bubble, meta.xlsx_full as Record<string, unknown> | undefined);
		}
		if (meta && typeof meta.docx_document_base64 === 'string' && meta.docx_document_base64) {
			this.renderDocxDownloadCard(
				bubble,
				String(meta.docx_export_suggested_filename ?? 'documento.docx'),
				meta.docx_document_base64,
				typeof meta.docx_size_bytes === 'number' ? meta.docx_size_bytes : undefined,
			);
		}
		if (meta && meta.document_kind === 'doc_read_result') {
			this.renderDocReadBadge(bubble, meta.documents_full as Record<string, unknown> | undefined);
		}
	}

	private renderDocReadBadge(bubble: HTMLElement, info: Record<string, unknown> | undefined): void {
		const headings = typeof info?.headings === 'number' ? info.headings : 0;
		const paragraphs = typeof info?.paragraphs === 'number' ? info.paragraphs : 0;
		const badge = dom.append(bubble, $('.polvo-pdf-read-badge'));
		badge.appendChild(renderIcon(Codicon.fileText));
		const label = dom.append(badge, $('span.polvo-pdf-read-badge-label'));
		const parts = [localize('polvoDocHeadings', "{0} secções", String(headings))];
		if (paragraphs > 0) {
			parts.push(localize('polvoDocParagraphs', "{0} parágrafos", String(paragraphs)));
		}
		label.textContent = localize('polvoDocAnalyzed', "Documento analisado") + ' · ' + parts.join(' · ');
	}

	private renderDocxDownloadCard(
		bubble: HTMLElement,
		filename: string,
		base64: string,
		sizeBytes?: number,
	): void {
		const card = dom.append(bubble, $('.polvo-pdf-download-card'));
		const iconWrap = dom.append(card, $('.polvo-pdf-download-icon'));
		iconWrap.appendChild(renderIcon(Codicon.fileText));
		const info = dom.append(card, $('.polvo-pdf-download-info'));
		const nameEl = dom.append(info, $('.polvo-pdf-download-name'));
		nameEl.textContent = filename;
		if (sizeBytes !== undefined && sizeBytes > 0) {
			const sizeEl = dom.append(info, $('.polvo-pdf-download-size'));
			const kb = Math.max(1, Math.round(sizeBytes / 1024));
			sizeEl.textContent = localize('polvoDocxSizeKb', "{0} KB", String(kb));
		}
		const downloadBtn = document.createElement('button');
		downloadBtn.type = 'button';
		downloadBtn.className = 'polvo-pdf-download-button';
		downloadBtn.title = localize('polvoDocxDownload', "Descarregar documento");
		downloadBtn.appendChild(renderIcon(Codicon.download));
		downloadBtn.appendChild(document.createTextNode(localize('polvoDocxDownload', "Descarregar documento")));
		this._register(dom.addDisposableListener(downloadBtn, dom.EventType.CLICK, () => {
			this.downloadDocxBase64(filename, base64);
		}));
		card.appendChild(downloadBtn);
	}

	private downloadDocxBase64(filename: string, base64: string): void {
		try {
			const binary = atob(base64);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) {
				bytes[i] = binary.charCodeAt(i);
			}
			const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = filename.endsWith('.docx') ? filename : `${filename}.docx`;
			anchor.click();
			URL.revokeObjectURL(url);
		} catch {
			// Falha silenciosa — o utilizador pode tentar novamente.
		}
	}

	private renderXlsxReadBadge(bubble: HTMLElement, info: Record<string, unknown> | undefined): void {
		const sheets = typeof info?.sheets === 'number' ? info.sheets : 0;
		const rows = typeof info?.rows === 'number' ? info.rows : 0;
		const badge = dom.append(bubble, $('.polvo-pdf-read-badge'));
		badge.appendChild(renderIcon(Codicon.table));
		const label = dom.append(badge, $('span.polvo-pdf-read-badge-label'));
		const parts = [localize('polvoXlsxSheets', "{0} folhas", String(sheets))];
		if (rows > 0) {
			parts.push(localize('polvoXlsxRows', "{0} linhas", String(rows)));
		}
		label.textContent = localize('polvoXlsxAnalyzed', "Planilha analisada") + ' · ' + parts.join(' · ');
	}

	private renderXlsxDownloadCard(
		bubble: HTMLElement,
		filename: string,
		base64: string,
		sizeBytes?: number,
	): void {
		const card = dom.append(bubble, $('.polvo-pdf-download-card'));
		const iconWrap = dom.append(card, $('.polvo-pdf-download-icon'));
		iconWrap.appendChild(renderIcon(Codicon.table));
		const info = dom.append(card, $('.polvo-pdf-download-info'));
		const nameEl = dom.append(info, $('.polvo-pdf-download-name'));
		nameEl.textContent = filename;
		if (sizeBytes !== undefined && sizeBytes > 0) {
			const sizeEl = dom.append(info, $('.polvo-pdf-download-size'));
			const kb = Math.max(1, Math.round(sizeBytes / 1024));
			sizeEl.textContent = localize('polvoXlsxSizeKb', "{0} KB", String(kb));
		}
		const downloadBtn = document.createElement('button');
		downloadBtn.type = 'button';
		downloadBtn.className = 'polvo-pdf-download-button';
		downloadBtn.title = localize('polvoXlsxDownload', "Descarregar planilha");
		downloadBtn.appendChild(renderIcon(Codicon.download));
		downloadBtn.appendChild(document.createTextNode(localize('polvoXlsxDownload', "Descarregar planilha")));
		this._register(dom.addDisposableListener(downloadBtn, dom.EventType.CLICK, () => {
			this.downloadXlsxBase64(filename, base64);
		}));
		card.appendChild(downloadBtn);
	}

	private downloadXlsxBase64(filename: string, base64: string): void {
		try {
			const binary = atob(base64);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) {
				bytes[i] = binary.charCodeAt(i);
			}
			const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
			anchor.click();
			URL.revokeObjectURL(url);
		} catch {
			// Falha silenciosa — o utilizador pode tentar novamente.
		}
	}

	private renderPdfReadBadge(bubble: HTMLElement, info: Record<string, unknown> | undefined): void {
		const pages = typeof info?.pages === 'number' ? info.pages : 0;
		const tables = typeof info?.tables_count === 'number' ? info.tables_count : 0;
		const ocrUsed = info?.ocr_used === true;
		const badge = dom.append(bubble, $('.polvo-pdf-read-badge'));
		badge.appendChild(renderIcon(Codicon.filePdf));
		const label = dom.append(badge, $('span.polvo-pdf-read-badge-label'));
		const parts = [localize('polvoPdfReadPages', "{0} páginas", String(pages))];
		if (tables > 0) {
			parts.push(localize('polvoPdfReadTables', "{0} tabelas", String(tables)));
		}
		if (ocrUsed) {
			parts.push(localize('polvoPdfReadOcr', "OCR aplicado"));
		}
		label.textContent = localize('polvoPdfReadAnalyzed', "PDF analisado") + ' · ' + parts.join(' · ');
	}

	private renderRichFormattingCard(bubble: HTMLElement, label?: string): void {
		const card = dom.append(bubble, $('.polvo-rich-formatting-card'));
		const pulse = dom.append(card, $('.polvo-rich-formatting-pulse'));
		pulse.appendChild(renderIcon(Codicon.sparkle));
		const status = dom.append(card, $('.polvo-rich-formatting-status'));
		status.textContent = label || localize('polvoRichFormatting', "A preparar resposta formatada…");
	}

	private renderPdfGeneratingCard(bubble: HTMLElement, label?: string): void {
		const card = dom.append(bubble, $('.polvo-pdf-generating-card'));
		const iconWrap = dom.append(card, $('.polvo-pdf-generating-icon'));
		iconWrap.appendChild(renderIcon(Codicon.filePdf));
		const body = dom.append(card, $('.polvo-pdf-generating-body'));
		const title = dom.append(body, $('.polvo-pdf-generating-title'));
		title.textContent = localize('polvoPdfGeneratingTitle', "documento.pdf");
		const status = dom.append(body, $('.polvo-pdf-generating-status'));
		status.textContent = label || localize('polvoPdfGenerating', "A gerar o PDF…");
		const lines = dom.append(body, $('.polvo-pdf-generating-lines'));
		for (let i = 0; i < 4; i++) {
			dom.append(lines, $('.polvo-pdf-generating-line'));
		}
	}

	private renderPdfDownloadCard(
		bubble: HTMLElement,
		filename: string,
		base64: string,
		sizeBytes?: number,
	): void {
		const card = dom.append(bubble, $('.polvo-pdf-download-card'));
		const iconWrap = dom.append(card, $('.polvo-pdf-download-icon'));
		iconWrap.appendChild(renderIcon(Codicon.filePdf));
		const info = dom.append(card, $('.polvo-pdf-download-info'));
		const nameEl = dom.append(info, $('.polvo-pdf-download-name'));
		nameEl.textContent = filename;
		if (sizeBytes !== undefined && sizeBytes > 0) {
			const sizeEl = dom.append(info, $('.polvo-pdf-download-size'));
			const kb = Math.max(1, Math.round(sizeBytes / 1024));
			sizeEl.textContent = localize('polvoPdfSizeKb', "{0} KB", String(kb));
		}
		const downloadBtn = document.createElement('button');
		downloadBtn.type = 'button';
		downloadBtn.className = 'polvo-pdf-download-button';
		downloadBtn.title = localize('polvoPdfDownload', "Descarregar PDF");
		downloadBtn.appendChild(renderIcon(Codicon.download));
		downloadBtn.appendChild(document.createTextNode(localize('polvoPdfDownload', "Descarregar PDF")));
		this._register(dom.addDisposableListener(downloadBtn, dom.EventType.CLICK, () => {
			this.downloadPdfBase64(filename, base64);
		}));
		card.appendChild(downloadBtn);
	}

	private downloadPdfBase64(filename: string, base64: string): void {
		try {
			const binary = atob(base64);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) {
				bytes[i] = binary.charCodeAt(i);
			}
			const blob = new Blob([bytes], { type: 'application/pdf' });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
			anchor.click();
			URL.revokeObjectURL(url);
		} catch {
			// Falha silenciosa — o utilizador pode tentar novamente.
		}
	}
}
