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
import { IPolvoAgentConversationsService, type IPolvoConversationMessage } from './polvoAgentConversationsService.js';
import { IOpenPolvoModel, IOpenPolvoWorkbenchApiService, type IOpenPolvoStreamEvent } from './openPolvoWorkbenchApiService.js';

const $ = dom.$;

interface IQuickAction {
	readonly icon: ThemeIcon;
	readonly label: string;
	readonly prompt: string;
}

export class PolvoAgentChatEditor extends EditorPane {
	static readonly ID = PolvoAgentChatEditorInput.EditorID;

	private container: HTMLElement | undefined;
	private messagesInner: HTMLElement | undefined;
	private inputElement: HTMLTextAreaElement | undefined;
	private modelLabelElement: HTMLElement | undefined;
	private modelChip: HTMLButtonElement | undefined;
	private sendButton: HTMLButtonElement | undefined;
	private conversationId: string | undefined;
	private models: IOpenPolvoModel[] = [];
	private isSending = false;
	private abortController: AbortController | undefined;

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
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
	) {
		super(PolvoAgentChatEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.container = dom.append(parent, $('.polvo-agent-chat-editor'));

		const messagesArea = dom.append(this.container, $('.polvo-agent-chat-messages'));
		this.messagesInner = dom.append(messagesArea, $('.polvo-agent-chat-messages-inner'));

		const composer = dom.append(this.container, $('.polvo-agent-chat-composer'));
		const composerInner = dom.append(composer, $('.polvo-agent-chat-composer-inner'));

		const composerBox = dom.append(composerInner, $('.polvo-agent-chat-composer-box'));

		this.inputElement = document.createElement('textarea');
		this.inputElement.className = 'polvo-agent-chat-input';
		this.inputElement.placeholder = localize('polvoAgentChatPlaceholder', "Como posso ajudar você hoje?");
		this.inputElement.rows = 3;
		composerBox.appendChild(this.inputElement);

		const composerFooter = dom.append(composerBox, $('.polvo-agent-chat-composer-footer'));

		const attachButton = document.createElement('button');
		attachButton.className = 'polvo-agent-chat-icon-button';
		attachButton.type = 'button';
		attachButton.title = localize('polvoAgentAttach', "Anexar contexto");
		attachButton.appendChild(renderIcon(Codicon.add));
		attachButton.setAttribute('aria-label', localize('polvoAgentAttach', "Anexar contexto"));
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
		this._register(dom.addDisposableListener(attachButton, dom.EventType.CLICK, () => this.inputElement?.focus()));
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
		this.models = await this.openPolvoApi.listModels();
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
			const apiSessionId = await this.openPolvoApi.createSession(conversation.title, conversation.modelId);
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
		const text = this.inputElement.value.trim();
		if (!text) {
			return;
		}

		const conversation = this.conversationsService.getConversation(this.conversationId);
		if (!conversation) {
			return;
		}

		this.conversationsService.addMessage(this.conversationId, 'user', text);
		this.inputElement.value = '';
		this.autoResizeInput();
		this.renderMessages();

		this.setSending(true);
		this.abortController?.abort();
		this.abortController = new AbortController();

		let apiSessionId = conversation.apiSessionId;
		try {
			if (!apiSessionId) {
				apiSessionId = await this.openPolvoApi.createSession(conversation.title, conversation.modelId);
				this.conversationsService.setApiSessionId(this.conversationId, apiSessionId);
			}

			this.conversationsService.addMessage(this.conversationId, 'assistant', '');
			this.renderMessages();

			let assistantText = '';
			let assistantMetadata: Record<string, unknown> | undefined;
			let pdfGenerating = false;
			let pdfProgressLabel = '';

			const handleStreamEvent = (event: IOpenPolvoStreamEvent): void => {
				if (event.type === 'text_delta' && event.delta) {
					assistantText += event.delta;
					this.conversationsService.updateAssistantMessage(this.conversationId!, assistantText, {
						pdfGenerating,
						pdfProgressLabel,
						metadata: assistantMetadata,
					});
					this.renderMessages();
				} else if (event.type === 'progress') {
					const step = String(event.payload?.step ?? '');
					if (step.startsWith('pdf_') || event.payload?.document_kind === 'pdf_study_report') {
						pdfGenerating = true;
						pdfProgressLabel = event.content ?? event.payload?.label as string ?? '';
						this.conversationsService.updateAssistantMessage(
							this.conversationId!,
							assistantText || pdfProgressLabel,
							{ pdfGenerating: true, pdfProgressLabel, metadata: assistantMetadata },
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
					this.conversationsService.updateAssistantMessage(this.conversationId!, assistantText, {
						metadata: assistantMetadata,
						pdfGenerating: false,
					});
					this.renderMessages();
				}
			};

			await this.openPolvoApi.streamMessage(
				apiSessionId,
				text,
				conversation.modelId,
				handleStreamEvent,
				this.abortController.signal,
			);

			if (!assistantText) {
				const last = this.conversationsService.getConversation(this.conversationId)?.messages.at(-1);
				if (last?.role === 'assistant' && !last.content) {
					this.conversationsService.updateAssistantMessage(
						this.conversationId,
						localize('polvoAgentEmptyResponse', "Sem resposta do servidor.")
					);
					this.renderMessages();
				}
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.conversationsService.addMessage(
				this.conversationId,
				'assistant',
				localize('polvoAgentApiError', "Não foi possível contactar a API OpenPolvo: {0}", message)
			);
			this.renderMessages();
		} finally {
			this.setSending(false);
		}
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

		for (const message of conversation.messages) {
			const messageEl = dom.append(this.messagesInner, $('.polvo-agent-chat-message'));
			messageEl.classList.add(message.role);
			const bubble = dom.append(messageEl, $('.polvo-agent-chat-bubble'));
			if (message.role === 'assistant') {
				this.renderAssistantBubble(bubble, message);
			} else {
				bubble.textContent = message.content;
			}
		}

		this.messagesInner.parentElement?.scrollTo({ top: this.messagesInner.parentElement.scrollHeight });
	}

	private renderAssistantBubble(bubble: HTMLElement, message: IPolvoConversationMessage): void {
		if (message.pdfGenerating) {
			this.renderPdfGeneratingCard(bubble, message.pdfProgressLabel);
			return;
		}
		if (message.content) {
			const textEl = dom.append(bubble, $('.polvo-agent-chat-text'));
			textEl.textContent = message.content;
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
