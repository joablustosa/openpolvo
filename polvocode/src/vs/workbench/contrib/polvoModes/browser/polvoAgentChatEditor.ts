/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { Dimension } from '../../../../base/browser/dom.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { showOpenPolvoModelPicker } from './openPolvoModelPicker.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { readProjectRootFromMetadata } from '../../../../platform/agentHost/common/openPolvoDevProject.js';
import { IExplorerService } from '../../files/browser/files.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { PolvoAgentChatEditorInput } from './polvoAgentChatEditorInput.js';
import { IPolvoAgentConversationsService, type IPolvoConversationMessage, type IPolvoDevFileChange, type IPolvoMessageAttachment } from './polvoAgentConversationsService.js';
import { IPolvoAgentChatContextService, type IPolvoCodeReferenceMeta } from './polvoAgentChatContextService.js';
import { IOpenPolvoModel, IOpenPolvoWorkbenchApiService, type IOpenPolvoStreamEvent } from './openPolvoWorkbenchApiService.js';
import type { IOpenPolvoAttachment, IOpenPolvoCodeReference } from '../../../../platform/agentHost/common/openpolvoBackendProtocol.js';
import { IOpenPolvoSignInService } from './openPolvoAuth.js';
import { withOpenPolvoApiAuth } from './openPolvoApiAuthHelper.js';
import { extractRichBlocks, markdownToRichBlocks, renderRichChatBlocks } from './polvoRichChatRenderer.js';
import {
	appendResponseTimerLabel,
	isAssistantResponseLoading,
	PolvoChatResponseTimerController,
	renderLoadingPlaceholder,
} from './polvoChatResponseTimer.js';
import { IWorkspaceEditingService } from '../../../services/workspaces/common/workspaceEditing.js';
import { applyDevFileToWorkspaceFolder, ensureUniquePolvoProjectRoot, openPolvoProjectFolderInExplorer, projectRootFromMetadata, runPolvoProjectPostSetupInTerminal, shouldOpenPolvoProjectInExplorer } from './openPolvoDevWorkspaceFiles.js';
import { IPolvoAgentHistorySyncService } from './polvoAgentHistorySyncService.js';

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
	private devProjectRootRel: string | undefined;
	private devProjectRootRequestedRel: string | undefined;
	private devProjectRootSetup: Promise<string | undefined> | undefined;
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
		@IPolvoAgentChatContextService private readonly chatContextService: IPolvoAgentChatContextService,
		@IPolvoAgentHistorySyncService private readonly historySyncService: IPolvoAgentHistorySyncService,
		@IOpenPolvoWorkbenchApiService private readonly openPolvoApi: IOpenPolvoWorkbenchApiService,
		@IOpenPolvoSignInService private readonly signInService: IOpenPolvoSignInService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@IExplorerService private readonly explorerService: IExplorerService,
		@IWorkspaceEditingService private readonly workspaceEditingService: IWorkspaceEditingService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
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
		this._register(dom.addDisposableListener(this.modelChip, dom.EventType.CLICK, e => void this.showModelPicker(e)));

		const quickActionsRow = dom.append(composerInner, $('.polvo-agent-chat-quick-actions'));
		for (const action of this.quickActions) {
			const pill = document.createElement('button');
			pill.className = 'polvo-agent-chat-quick-action';
			pill.type = 'button';
			pill.appendChild(renderIcon(action.icon));
			pill.appendChild(document.createTextNode(action.label));
			quickActionsRow.appendChild(pill);
			this._register(dom.addDisposableListener(pill, dom.EventType.CLICK, () => {
				if (action.icon === Codicon.code) {
					this.chatContextService.addFromEditorSelection();
					this.renderComposerChips();
					if (this.inputElement && !this.inputElement.value.trim()) {
						this.inputElement.value = localize('polvoQuickCodePrompt', "Ajude-me com o código selecionado no workspace.");
					}
					this.inputElement?.focus();
					return;
				}
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
		this._register(this.chatContextService.onDidChangePendingReferences(() => this.renderComposerChips()));

		void this.loadModels();
	}

	override async setInput(input: PolvoAgentChatEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this.conversationId = input.resource.path;
		this.conversationsService.setActiveConversation(this.conversationId);
		await this.signInService.ensureSignedIn();
		await this.ensureApiSession();
		const conversation = this.conversationsService.getConversation(this.conversationId);
		if (conversation?.apiSessionId && conversation.messages.length === 0) {
			await this.historySyncService.syncConversationMessages(this.conversationId);
		}
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

	private async showModelPicker(_e: MouseEvent): Promise<void> {
		// Seletor agrupado: IA local detectada + GPT/Gemini/Claude com estado
		// configurado (✓) ou por-configurar (🔒). Ao escolher 🔒 abre a config de chave.
		const selected = await this.instantiationService.invokeFunction(showOpenPolvoModelPicker);
		if (selected && this.conversationId) {
			this.conversationsService.setConversationModel(this.conversationId, selected);
			await this.loadModels();
			this.updateModelLabel();
		}
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
		const codeRefs = this.chatContextService.consumePendingReferences();
		const codeRefMeta: IPolvoCodeReferenceMeta[] = codeRefs.map(r => this.chatContextService.toMeta(r));
		if (!rawText && files.length === 0 && codeRefs.length === 0) {
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

		// O agente de leitura precisa de um pedido; se o utilizador só anexou ficheiros/refs, assume análise.
		const text = rawText || (codeRefs.length > 0
			? localize('polvoCodeRefDefaultPrompt', "Analise o código referenciado.")
			: localize('polvoAttachDefaultPrompt', "Analise este documento e faça um resumo."));
		const attachmentMeta: IPolvoMessageAttachment[] = files.map(f => ({
			name: f.name,
			mimeType: f.type || 'application/pdf',
			sizeBytes: f.size,
		}));

		this.conversationsService.addMessage(this.conversationId, 'user', text, attachmentMeta, codeRefMeta);
		this.inputElement.value = '';
		this.clearPendingAttachments();
		this.renderComposerChips();
		this.autoResizeInput();
		this.renderMessages();

		this.setSending(true);
		this.responseTimer.start();
		this.abortController?.abort();
		this.abortController = new AbortController();
		this.devProjectRootRel = undefined;
		this.devProjectRootRequestedRel = undefined;
		this.devProjectRootSetup = undefined;

		let apiSessionId = conversation.apiSessionId;
		try {
			await withOpenPolvoApiAuth(this.signInService, async () => {
				if (!apiSessionId) {
					apiSessionId = await this.openPolvoApi.createSession(conversation.title, conversation.modelId);
					this.conversationsService.setApiSessionId(this.conversationId!, apiSessionId);
				}

				let assistantText = '';
				let assistantMetadata: Record<string, unknown> | undefined;
				let pdfGenerating = false;
				let pdfProgressLabel = '';
				let richFormatting = false;
				let richProgressLabel = '';
				const devFileChanges: IPolvoDevFileChange[] = [];
				const appliedDevPaths = new Set<string>();
				let lastDevWorkflowStepId = '';

				const handleStreamEvent = (event: IOpenPolvoStreamEvent): void => {
				if (event.type === 'text_delta' && event.delta) {
					assistantText += event.delta;
					this.conversationsService.updateDevResponseMessage(this.conversationId!, assistantText, {
						pdfGenerating,
						pdfProgressLabel,
						richFormatting,
						richProgressLabel,
						devFileChanges,
						metadata: assistantMetadata,
					});
					this.renderMessages();
				} else if (event.type === 'progress') {
					const step = String(event.payload?.step ?? '');
					if (step === 'dev_project_root') {
						const root = event.payload?.project_root;
						if (typeof root === 'string' && root.trim()) {
							void this.scheduleDevProjectRoot(root);
						}
					} else if (step.startsWith('dev_')) {
						const label = event.content ?? event.payload?.label as string ?? '';
						if (label && step !== lastDevWorkflowStepId) {
							lastDevWorkflowStepId = step;
							this.conversationsService.appendDevStepMessage(this.conversationId!, label);
							this.renderMessages();
						}
					} else if (step.startsWith('doc_') || event.payload?.document_kind === 'docx_result' || event.payload?.document_kind === 'doc_read_result') {
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
				} else if (event.type === 'file' && event.file?.path) {
					const change: IPolvoDevFileChange = {
						path: event.file.path,
						op: event.file.op ?? 'write',
					};
					devFileChanges.push(change);
					appliedDevPaths.add(event.file.path.replace(/\\/g, '/').replace(/^\/+/, ''));
					this.conversationsService.updateDevResponseMessage(this.conversationId!, assistantText, {
						devFileChanges: [...devFileChanges],
						pdfGenerating,
						pdfProgressLabel,
						richFormatting,
						richProgressLabel,
						metadata: assistantMetadata,
					});
					this.renderMessages();
					void this.persistDevFileAndReveal({
						path: event.file.path,
						content: event.file.content,
						op: event.file.op ?? 'write',
					});
				} else if (event.type === 'file_edit' && event.fileEdit?.path) {
					const change: IPolvoDevFileChange = {
						path: event.fileEdit.path,
						op: event.fileEdit.op ?? 'write',
						added: event.fileEdit.added,
						removed: event.fileEdit.removed,
					};
					devFileChanges.push(change);
					appliedDevPaths.add(event.fileEdit.path.replace(/\\/g, '/').replace(/^\/+/, ''));
					this.conversationsService.updateDevResponseMessage(this.conversationId!, assistantText, {
						devFileChanges: [...devFileChanges],
						pdfGenerating,
						pdfProgressLabel,
						richFormatting,
						richProgressLabel,
						metadata: assistantMetadata,
					});
					this.renderMessages();
					void this.persistDevFileAndReveal({
						path: event.fileEdit.path,
						op: event.fileEdit.op ?? 'write',
					});
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
						const root = readProjectRootFromMetadata(event.metadata);
						if (root) {
							void this.scheduleDevProjectRoot(root);
						}
					}
					pdfGenerating = false;
					richFormatting = false;
					this.conversationsService.finalizeLastDevStep(this.conversationId!);
					this.conversationsService.updateDevResponseMessage(this.conversationId!, assistantText, {
						metadata: assistantMetadata,
						pdfGenerating: false,
						richFormatting: false,
						devFileChanges,
					});
					this.renderMessages();
					void (async () => {
						await this.applyPolvoCodeOpsFromMetadata(assistantMetadata, appliedDevPaths, devFileChanges);
						await this.openCreatedProjectInExplorer(assistantMetadata);
						await this.runCreatedProjectPostSetup(assistantMetadata);
					})();
				} else if (event.type === 'messages_saved' && event.messages?.length) {
					this.conversationsService.reconcileServerMessageIds(
						this.conversationId!,
						event.messages.map(m => ({ id: m.id, role: m.role })),
					);
				}
			};

			const apiCodeRefs: IOpenPolvoCodeReference[] = codeRefs.map(r => ({
				path: r.relativePath,
				start_line: r.startLine,
				end_line: r.endLine,
				text: r.text,
			}));

			await this.openPolvoApi.streamMessage(
				apiSessionId!,
				text,
				conversation.modelId,
				handleStreamEvent,
				this.abortController.signal,
				attachments,
				apiCodeRefs.length > 0 ? apiCodeRefs : undefined,
			);

			if (!assistantText) {
				const conversation = this.conversationsService.getConversation(this.conversationId!);
				const hasDevSteps = conversation?.messages.some(m => m.devFormatting || m.devStepDone);
				const responseMsg = conversation?.messages.findLast(m => m.devResponse);
				if (!hasDevSteps && responseMsg && !responseMsg.content) {
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
				const last = conversation?.messages.findLast(m =>
					m.role === 'assistant' && (m.devResponse || (!m.devFormatting && !m.devStepDone)),
				);
				if (last) {
					const updater = last.devResponse
						? this.conversationsService.updateDevResponseMessage.bind(this.conversationsService)
						: this.conversationsService.updateAssistantMessage.bind(this.conversationsService);
					updater(this.conversationId, last.content, {
						metadata: last.metadata,
						pdfGenerating: last.pdfGenerating,
						pdfProgressLabel: last.pdfProgressLabel,
						richFormatting: last.richFormatting,
						richProgressLabel: last.richProgressLabel,
						devFormatting: last.devFormatting,
						devProgressLabel: last.devProgressLabel,
						devStepDone: last.devStepDone,
						devResponse: last.devResponse,
						devFileChanges: last.devFileChanges,
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
		this.renderComposerChips();
	}

	private renderComposerChips(): void {
		this.renderAttachmentChips();
	}

	private renderAttachmentChips(): void {
		if (!this.attachmentsRow) {
			return;
		}
		dom.clearNode(this.attachmentsRow);
		const pendingRefs = this.chatContextService.pendingReferences;
		if (this.pendingAttachments.length === 0 && pendingRefs.length === 0) {
			this.attachmentsRow.style.display = 'none';
			return;
		}
		this.attachmentsRow.style.display = 'flex';
		for (let i = 0; i < pendingRefs.length; i++) {
			const ref = pendingRefs[i];
			const meta = this.chatContextService.toMeta(ref);
			const chip = dom.append(this.attachmentsRow, $('.polvo-agent-chat-attachment-chip.polvo-agent-chat-code-ref-chip'));
			chip.appendChild(renderIcon(Codicon.code));
			const name = dom.append(chip, $('span.polvo-agent-chat-attachment-name'));
			name.textContent = `${meta.path}:L${meta.startLine}-${meta.endLine}`;
			name.title = meta.preview;
			const remove = document.createElement('button');
			remove.type = 'button';
			remove.className = 'polvo-agent-chat-attachment-remove';
			remove.title = localize('polvoCodeRefRemove', "Remover referência");
			remove.appendChild(renderIcon(Codicon.close));
			const index = i;
			this._register(dom.addDisposableListener(remove, dom.EventType.CLICK, () => {
				this.chatContextService.removeReference(index);
				this.renderComposerChips();
			}));
			chip.appendChild(remove);
		}
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
		if (message.codeReferences && message.codeReferences.length > 0) {
			const row = dom.append(bubble, $('.polvo-agent-chat-message-attachments'));
			for (const ref of message.codeReferences) {
				const chip = dom.append(row, $('.polvo-agent-chat-attachment-chip.is-sent.polvo-agent-chat-code-ref-chip'));
				chip.appendChild(renderIcon(Codicon.code));
				const name = dom.append(chip, $('span.polvo-agent-chat-attachment-name'));
				name.textContent = `${ref.path}:L${ref.startLine}-${ref.endLine}`;
				name.title = ref.preview;
			}
		}
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
		if (isLoading && !message.content && !message.pdfGenerating && !message.richFormatting && !message.devFormatting) {
			renderLoadingPlaceholder(bubble, elapsedSeconds ?? 0);
			return;
		}
		if (message.pdfGenerating) {
			this.renderPdfGeneratingCard(bubble, message.pdfProgressLabel);
			return;
		}
		if (message.devStepDone) {
			this.renderDevStepDoneCard(bubble, message.devProgressLabel ?? message.content);
			return;
		}
		if (message.devFormatting) {
			this.renderDevFormattingCard(bubble, message.devProgressLabel);
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
		if (message.devFileChanges && message.devFileChanges.length > 0) {
			for (const change of message.devFileChanges) {
				this.renderDevFileCard(bubble, change);
			}
		}
	}

	private renderDevFormattingCard(bubble: HTMLElement, label?: string): void {
		const card = dom.append(bubble, $('.polvo-rich-formatting-card'));
		const pulse = dom.append(card, $('.polvo-rich-formatting-pulse'));
		pulse.appendChild(renderIcon(Codicon.code));
		const status = dom.append(card, $('.polvo-rich-formatting-status'));
		status.textContent = label || localize('polvoDevFormatting', "A gerar alterações no código…");
	}

	private renderDevStepDoneCard(bubble: HTMLElement, label?: string): void {
		const card = dom.append(bubble, $('.polvo-rich-formatting-card.is-done'));
		const icon = dom.append(card, $('.polvo-rich-formatting-pulse'));
		icon.appendChild(renderIcon(Codicon.check));
		const status = dom.append(card, $('.polvo-rich-formatting-status'));
		status.textContent = label || localize('polvoDevStepDone', "Passo concluído");
	}

	private renderDevFileCard(bubble: HTMLElement, change: IPolvoDevFileChange): void {
		const card = dom.append(bubble, $('.polvo-pdf-download-card'));
		const iconWrap = dom.append(card, $('.polvo-pdf-download-icon'));
		iconWrap.appendChild(renderIcon(change.op === 'mkdir' ? Codicon.folder : Codicon.fileCode));
		const info = dom.append(card, $('.polvo-pdf-download-info'));
		const nameEl = dom.append(info, $('.polvo-pdf-download-name'));
		nameEl.textContent = change.path;
		const sizeEl = dom.append(info, $('.polvo-pdf-download-size'));
		if (change.op === 'mkdir') {
			sizeEl.textContent = localize('polvoDevMkdirLabel', "Nova pasta");
		} else if (change.added !== undefined || change.removed !== undefined) {
			const parts: string[] = [];
			if (change.added) {
				parts.push(localize('polvoDevLinesAdded', "+{0}", String(change.added)));
			}
			if (change.removed) {
				parts.push(localize('polvoDevLinesRemoved', "-{0}", String(change.removed)));
			}
			sizeEl.textContent = parts.join(' · ');
		} else {
			sizeEl.textContent = localize('polvoDevFileUpdated', "Ficheiro atualizado");
		}
		const openBtn = document.createElement('button');
		openBtn.type = 'button';
		openBtn.className = 'polvo-pdf-download-button';
		openBtn.title = localize('polvoDevOpenFile', "Abrir ficheiro");
		openBtn.appendChild(renderIcon(Codicon.goToFile));
		openBtn.appendChild(document.createTextNode(localize('polvoDevOpenFile', "Abrir ficheiro")));
		this._register(dom.addDisposableListener(openBtn, dom.EventType.CLICK, () => {
			void this.openDevFileInEditor(change.path);
		}));
		card.appendChild(openBtn);
	}

	private async openCreatedProjectInExplorer(metadata: Record<string, unknown> | undefined): Promise<void> {
		if (!shouldOpenPolvoProjectInExplorer(metadata)) {
			return;
		}
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) {
			return;
		}
		const root = await this.resolveCreatedProjectRoot(metadata);
		if (!root) {
			return;
		}
		await openPolvoProjectFolderInExplorer(
			this.fileService,
			this.workspaceContextService,
			this.workspaceEditingService,
			this.explorerService,
			folders[0].uri,
			root,
		);
	}

	private async scheduleDevProjectRoot(requestedRoot: string): Promise<string | undefined> {
		const normalized = requestedRoot.trim().replace(/\\/g, '/').replace(/^\/+/, '');
		if (!normalized) {
			return undefined;
		}
		this.devProjectRootRequestedRel ??= normalized;
		if (this.devProjectRootSetup) {
			return this.devProjectRootSetup;
		}
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) {
			this.devProjectRootRel = normalized;
			return normalized;
		}
		this.devProjectRootSetup = ensureUniquePolvoProjectRoot(
			this.fileService,
			folders[0].uri,
			normalized,
		).then(root => {
			this.devProjectRootRel = root ?? normalized;
			return this.devProjectRootRel;
		});
		return this.devProjectRootSetup;
	}

	private normalizeIncomingDevFilePath(path: string): string {
		let normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
		const requested = this.devProjectRootRequestedRel;
		if (
			requested
			&& this.devProjectRootRel
			&& requested !== this.devProjectRootRel
			&& normalized.startsWith(`${requested}/`)
		) {
			normalized = normalized.slice(requested.length + 1);
		}
		return normalized;
	}

	private async resolveCreatedProjectRoot(metadata: Record<string, unknown> | undefined): Promise<string | undefined> {
		if (this.devProjectRootSetup) {
			return this.devProjectRootSetup;
		}
		const root = projectRootFromMetadata(metadata) ?? this.devProjectRootRel;
		return root ? this.scheduleDevProjectRoot(root) : undefined;
	}

	private async applyPolvoCodeOpsFromMetadata(
		metadata: Record<string, unknown> | undefined,
		appliedDevPaths: Set<string>,
		devFileChanges: IPolvoDevFileChange[],
	): Promise<void> {
		const ops = metadata?.polvo_code_ops;
		if (!Array.isArray(ops)) {
			return;
		}
		for (const raw of ops) {
			if (!raw || typeof raw !== 'object') {
				continue;
			}
			const op = raw as Record<string, unknown>;
			const path = String(op.path ?? '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
			if (!path || appliedDevPaths.has(path)) {
				continue;
			}
			const kind = op.op === 'mkdir' ? 'mkdir' : op.op === 'delete' ? 'delete' : 'write';
			await this.persistDevFileAndReveal({
				path,
				content: typeof op.content === 'string' ? op.content : '',
				op: kind,
			});
			appliedDevPaths.add(path);
			devFileChanges.push({ path, op: kind });
			if (this.conversationId) {
				const conversation = this.conversationsService.getConversation(this.conversationId);
				const response = conversation?.messages.findLast(m => m.role === 'assistant' && m.devResponse);
				this.conversationsService.updateDevResponseMessage(this.conversationId, response?.content ?? '', {
					devFileChanges: [...devFileChanges],
					metadata,
				});
				this.renderMessages();
			}
		}
	}

	private async runCreatedProjectPostSetup(metadata: Record<string, unknown> | undefined): Promise<void> {
		if (!shouldOpenPolvoProjectInExplorer(metadata)) {
			return;
		}
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) {
			return;
		}
		const root = await this.resolveCreatedProjectRoot(metadata);
		if (!root) {
			return;
		}
		try {
			const started = await runPolvoProjectPostSetupInTerminal(
				this.instantiationService,
				this.fileService,
				folders[0].uri,
				root,
				metadata,
			);
			if (started && this.conversationId) {
				this.conversationsService.appendDevStepMessage(
					this.conversationId,
					localize('polvoDevPostSetupStarted', "Setup do projecto iniciado no terminal integrado."),
				);
				this.renderMessages();
			}
		} catch {
			// best-effort: o projecto já foi criado e aberto; falhas de terminal não bloqueiam o chat.
		}
	}

	private async persistDevFileAndReveal(file: { path: string; content?: string; op?: 'write' | 'mkdir' | 'delete' }): Promise<void> {
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) {
			return;
		}
		if (this.devProjectRootSetup) {
			await this.devProjectRootSetup;
		}
		const normalizedFile = {
			...file,
			path: this.normalizeIncomingDevFilePath(file.path),
		};
		const resource = await applyDevFileToWorkspaceFolder(
			this.fileService,
			folders[0].uri,
			normalizedFile,
			this.devProjectRootRel,
		);
		if (!resource) {
			return;
		}
		try {
			await this.explorerService.refresh();
			await this.explorerService.select(resource, true);
			await this.editorService.openEditor({ resource, options: { pinned: false } });
		} catch {
			// best-effort
		}
	}

	private async openDevFileInEditor(relPath: string): Promise<void> {
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) {
			return;
		}
		const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
		const resource = URI.joinPath(folders[0].uri, ...normalized.split('/'));
		try {
			await this.editorService.openEditor({ resource, options: { pinned: false } });
		} catch {
			// best-effort
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
