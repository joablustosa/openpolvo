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
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { PolvoWorkflowEditorInput } from './polvoWorkflowEditorInput.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IPolvoWorkflowsService } from './polvoWorkflowsService.js';
import { IOpenPolvoModel, IOpenPolvoWorkbenchApiService, IOpenPolvoWorkflowGraph, IOpenPolvoWorkflowNode } from './openPolvoWorkbenchApiService.js';
import { IOpenPolvoSignInService } from './openPolvoAuth.js';
import { withOpenPolvoApiAuth } from './openPolvoApiAuthHelper.js';
import { sendPolvoWorkflowMessage } from './polvoWorkflowMessaging.js';
import { PolvoWorkflowCanvas } from './polvoWorkflowCanvas.js';
import { OpenPolvoWorkflowsBackendSettingId } from '../common/openpolvoConfiguration.js';
import {
	appendResponseTimerLabel,
	isAssistantResponseLoading,
	PolvoChatResponseTimerController,
	renderLoadingPlaceholder,
} from './polvoChatResponseTimer.js';
import type { IPolvoConversationMessage } from './polvoAgentConversationsService.js';

const $ = dom.$;

interface INodeFieldSpec {
	readonly key: string;
	readonly label: string;
	readonly multiline?: boolean;
}

const NODE_FIELD_SPECS: Record<string, INodeFieldSpec[]> = {
	schedule: [{ key: 'cron', label: 'Cron (5 campos)' }, { key: 'timezone', label: 'Fuso horário' }],
	goto: [{ key: 'url', label: 'URL' }],
	click: [{ key: 'selector', label: 'Seletor CSS' }],
	fill: [{ key: 'selector', label: 'Seletor CSS' }, { key: 'value', label: 'Valor' }],
	wait: [{ key: 'selector', label: 'Seletor CSS' }],
	llm: [{ key: 'prompt', label: 'Prompt', multiline: true }],
	web_search: [{ key: 'query', label: 'Pesquisa' }, { key: 'search_engine', label: 'Motor (duckduckgo/google)' }],
	send_email: [{ key: 'email_to', label: 'Para' }, { key: 'email_subject', label: 'Assunto' }, { key: 'email_body', label: 'Corpo', multiline: true }],
	post_facebook: [{ key: 'caption', label: 'Legenda', multiline: true }, { key: 'image_url', label: 'URL imagem' }],
	post_instagram: [{ key: 'caption', label: 'Legenda', multiline: true }, { key: 'image_url', label: 'URL imagem' }],
	post_whatsapp: [{ key: 'caption', label: 'Mensagem', multiline: true }, { key: 'whatsapp_to', label: 'Destinatário' }],
	post_linkedin: [{ key: 'caption', label: 'Legenda', multiline: true }, { key: 'image_url', label: 'URL imagem' }],
	post_x: [{ key: 'caption', label: 'Texto', multiline: true }],
	post_twitter: [{ key: 'caption', label: 'Texto', multiline: true }],
	post_youtube: [{ key: 'caption', label: 'Descrição', multiline: true }, { key: 'video_url', label: 'URL vídeo' }],
};

export class PolvoWorkflowEditor extends EditorPane {
	static readonly ID = PolvoWorkflowEditorInput.EditorID;

	private container: HTMLElement | undefined;
	private titleElement: HTMLElement | undefined;
	private summaryElement: HTMLElement | undefined;
	private messagesInner: HTMLElement | undefined;
	private inputElement: HTMLTextAreaElement | undefined;
	private modelLabelElement: HTMLElement | undefined;
	private modelChip: HTMLButtonElement | undefined;
	private sendButton: HTMLButtonElement | undefined;
	private canvas: PolvoWorkflowCanvas | undefined;
	private propsPanel: HTMLElement | undefined;
	private workflowId: string | undefined;
	private selectedNodeId: string | undefined;
	private models: IOpenPolvoModel[] = [];
	private isSending = false;
	private abortController: AbortController | undefined;
	private readonly responseTimer = new PolvoChatResponseTimerController(() => this.renderMessages());
	private readonly propsDisposables = this._register(new DisposableStore());

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IPolvoWorkflowsService private readonly workflowsService: IPolvoWorkflowsService,
		@IOpenPolvoWorkbenchApiService private readonly openPolvoApi: IOpenPolvoWorkbenchApiService,
		@IOpenPolvoSignInService private readonly signInService: IOpenPolvoSignInService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
	) {
		super(PolvoWorkflowEditor.ID, group, telemetryService, themeService, storageService);
		this._register(this.responseTimer);
	}

	protected createEditor(parent: HTMLElement): void {
		this.container = dom.append(parent, $('.polvo-workflow-editor.polvo-workflow-agent'));

		const header = dom.append(this.container, $('.polvo-workflow-agent-header'));
		const headerText = dom.append(header, $('.polvo-workflow-agent-header-text'));
		this.titleElement = dom.append(headerText, document.createElement('h1'));
		this.titleElement.textContent = localize('polvoWorkflowTitle', "Automações");
		this.summaryElement = dom.append(headerText, document.createElement('p'));
		this.summaryElement.className = 'subtitle';

		const body = dom.append(this.container, $('.polvo-workflow-agent-body'));
		const canvasPane = dom.append(body, $('.polvo-workflow-canvas-pane'));
		this.canvas = this._register(new PolvoWorkflowCanvas(canvasPane));
		this._register(this.canvas.onDidSelectNode(nodeId => this.onSelectNode(nodeId)));
		this.propsPanel = dom.append(canvasPane, $('.polvo-workflow-props'));
		this.propsPanel.style.display = 'none';

		const chatPane = dom.append(body, $('.polvo-workflow-chat-pane'));
		this.createChatPane(chatPane);

		this._register(this.workflowsService.onDidChangeWorkflows(() => this.renderWorkflow()));
		this._register(this.workflowsService.onDidChangeActiveWorkflow(() => this.renderWorkflow()));

		void this.loadModels();
	}

	private createChatPane(parent: HTMLElement): void {
		const messagesArea = dom.append(parent, $('.polvo-workflow-messages'));
		this.messagesInner = dom.append(messagesArea, $('.polvo-workflow-messages-inner'));

		const composer = dom.append(parent, $('.polvo-agent-chat-composer.polvo-workflow-editor-composer'));
		const composerInner = dom.append(composer, $('.polvo-agent-chat-composer-inner'));
		const composerBox = dom.append(composerInner, $('.polvo-agent-chat-composer-box'));

		this.inputElement = document.createElement('textarea');
		this.inputElement.className = 'polvo-agent-chat-input';
		this.inputElement.placeholder = localize('polvoWorkflowRefinePlaceholder', "Descreva ou refine esta automação em linguagem natural...");
		this.inputElement.rows = 2;
		composerBox.appendChild(this.inputElement);

		const composerFooter = dom.append(composerBox, $('.polvo-agent-chat-composer-footer'));
		const footerRight = dom.append(composerFooter, $('.polvo-agent-chat-composer-footer-right'));

		this.modelChip = document.createElement('button');
		this.modelChip.className = 'polvo-agent-chat-model-chip';
		this.modelChip.type = 'button';
		this.modelLabelElement = dom.append(this.modelChip, $('span.polvo-agent-chat-model-label'));
		this.modelLabelElement.textContent = localize('polvoAgentLoadingModels', "Carregando...");
		this.modelChip.appendChild(renderIcon(Codicon.chevronDown));
		footerRight.appendChild(this.modelChip);

		this.sendButton = document.createElement('button');
		this.sendButton.className = 'polvo-agent-chat-send-button';
		this.sendButton.type = 'button';
		this.sendButton.appendChild(renderIcon(Codicon.arrowUp));
		footerRight.appendChild(this.sendButton);

		this._register(dom.addDisposableListener(this.sendButton, dom.EventType.CLICK, () => void this.sendMessage()));
		this._register(dom.addDisposableListener(this.modelChip, dom.EventType.CLICK, e => this.showModelPicker(e)));
		this._register(dom.addDisposableListener(this.inputElement, dom.EventType.KEY_DOWN, e => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				void this.sendMessage();
			}
		}));
	}

	override async setInput(input: PolvoWorkflowEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		const workflow = this.workflowsService.getWorkflow(input.resource.path);
		this.workflowId = workflow?.id ?? input.resource.path;
		this.selectedNodeId = undefined;
		this.workflowsService.setActiveWorkflow(this.workflowId);
		await this.signInService.ensureSignedIn();
		await this.ensureWorkflowGraphLoaded();
		this.renderWorkflow();
	}

	private async ensureWorkflowGraphLoaded(): Promise<void> {
		if (!this.workflowId) {
			return;
		}
		const workflow = this.workflowsService.getWorkflow(this.workflowId);
		if (!workflow?.backendId) {
			return;
		}
		const hasNodes = (workflow.graph?.nodes?.length ?? 0) > 0;
		if (hasNodes) {
			return;
		}
		try {
			const record = await withOpenPolvoApiAuth(this.signInService, () =>
				this.openPolvoApi.getWorkflow(workflow.backendId!),
				this.openPolvoApi,
			);
			if (record?.graph) {
				this.workflowsService.setGraph(this.workflowId, { graph: record.graph, title: record.title });
			}
		} catch (err) {
			this.logService.warn(`[OpenPolvo] Failed to load workflow graph: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	override layout(dimension: Dimension): void {
		if (this.container) {
			this.container.style.width = `${dimension.width}px`;
			this.container.style.height = `${dimension.height}px`;
		}
	}

	private async loadModels(): Promise<void> {
		this.models = await withOpenPolvoApiAuth(this.signInService, () => this.openPolvoApi.listModels(), this.openPolvoApi);
		this.updateModelLabel();
	}

	private updateModelLabel(): void {
		if (!this.modelLabelElement || !this.workflowId) {
			return;
		}
		const workflow = this.workflowsService.getWorkflow(this.workflowId);
		const modelId = workflow?.modelId ?? 'polvo';
		const model = this.models.find(m => m.id === modelId) ?? this.models[0];
		this.modelLabelElement.textContent = model?.name ?? localize('polvoAgentDefaultModel', "Polvo");
	}

	private showModelPicker(e: MouseEvent): void {
		if (!this.workflowId || this.models.length === 0) {
			void this.loadModels().then(() => this.showModelPicker(e));
			return;
		}
		const workflow = this.workflowsService.getWorkflow(this.workflowId);
		this.contextMenuService.showContextMenu({
			getAnchor: () => ({ x: e.clientX, y: e.clientY }),
			getActions: () => this.models.map(model => {
				const action = new Action(`polvo-wf-model-${model.id}`, model.name, undefined, true, () => {
					this.workflowsService.setWorkflowModel(this.workflowId!, model.id);
					this.updateModelLabel();
				});
				action.checked = model.id === workflow?.modelId;
				return action;
			}),
		});
	}

	private async sendMessage(): Promise<void> {
		if (!this.inputElement || !this.workflowId || this.isSending) {
			return;
		}
		const text = this.inputElement.value.trim();
		if (!text) {
			return;
		}
		this.inputElement.value = '';
		this.setSending(true);
		this.responseTimer.start();
		this.abortController?.abort();
		this.abortController = new AbortController();
		try {
			await withOpenPolvoApiAuth(this.signInService, () =>
				sendPolvoWorkflowMessage(this.workflowsService, this.openPolvoApi, this.workflowId!, text, {
					useBackend: this.configurationService.getValue<boolean>(OpenPolvoWorkflowsBackendSettingId) !== false,
					signal: this.abortController!.signal,
				}),
				this.openPolvoApi,
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.workflowsService.addMessage(this.workflowId, 'assistant', localize('polvoWorkflowApiError', "Não foi possível contactar a API OpenPolvo: {0}", message));
		} finally {
			this.responseTimer.stop();
			this.setSending(false);
			this.renderWorkflow();
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

	private renderWorkflow(): void {
		if (!this.workflowId) {
			return;
		}
		const workflow = this.workflowsService.getWorkflow(this.workflowId);
		if (!workflow) {
			return;
		}
		if (this.titleElement) {
			this.titleElement.textContent = workflow.title || localize('polvoWorkflowTitle', "Automações");
		}
		if (this.summaryElement) {
			this.summaryElement.textContent = workflow.summary
				?? workflow.description
				?? localize('polvoWorkflowSubtitle', "Descreva ou refine esta automação em linguagem natural.");
		}
		this.canvas?.setGraph(workflow.graph);
		if (this.selectedNodeId && !this.findNode(this.selectedNodeId)) {
			this.selectedNodeId = undefined;
		}
		this.canvas?.setSelectedNode(this.selectedNodeId);
		this.renderPropsPanel();
		this.renderMessages();
	}

	private renderMessages(): void {
		if (!this.messagesInner || !this.workflowId) {
			return;
		}
		const workflow = this.workflowsService.getWorkflow(this.workflowId);
		if (!workflow) {
			return;
		}

		dom.clearNode(this.messagesInner);
		for (let i = 0; i < workflow.messages.length; i++) {
			const message = workflow.messages[i];
			const isLast = i === workflow.messages.length - 1;
			const isLoading = isAssistantResponseLoading(message, isLast, this.isSending);
			if (isLoading && !this.responseTimer.isRunning()) {
				this.responseTimer.start();
			}

			const messageEl = dom.append(this.messagesInner, $('.polvo-agent-chat-message'));
			messageEl.classList.add(message.role);
			const bubble = dom.append(messageEl, $('.polvo-agent-chat-bubble'));
			this.renderWorkflowMessageBubble(bubble, message, isLoading, isLoading ? this.responseTimer.getElapsedSeconds() : message.responseTimeSeconds);
			const elapsed = isLoading ? this.responseTimer.getElapsedSeconds() : message.responseTimeSeconds;
			if (message.role === 'assistant' && elapsed !== undefined) {
				appendResponseTimerLabel(messageEl, elapsed, isLoading);
			}
		}
		this.updateModelLabel();
	}

	private renderWorkflowMessageBubble(
		bubble: HTMLElement,
		message: IPolvoConversationMessage,
		isLoading: boolean,
		elapsedSeconds?: number,
	): void {
		if (isLoading && !message.content) {
			renderLoadingPlaceholder(bubble, elapsedSeconds ?? 0);
			return;
		}
		bubble.textContent = message.content;
	}

	private onSelectNode(nodeId: string | undefined): void {
		this.selectedNodeId = nodeId;
		this.renderPropsPanel();
	}

	private findNode(nodeId: string): IOpenPolvoWorkflowNode | undefined {
		if (!this.workflowId) {
			return undefined;
		}
		const graph = this.workflowsService.getWorkflow(this.workflowId)?.graph;
		return graph?.nodes.find(n => n.id === nodeId);
	}

	private renderPropsPanel(): void {
		if (!this.propsPanel) {
			return;
		}
		this.propsDisposables.clear();
		dom.clearNode(this.propsPanel);
		const node = this.selectedNodeId ? this.findNode(this.selectedNodeId) : undefined;
		if (!node) {
			this.propsPanel.style.display = 'none';
			return;
		}
		this.propsPanel.style.display = 'flex';

		const head = dom.append(this.propsPanel, $('.polvo-workflow-props-head'));
		dom.append(head, $('.polvo-workflow-props-title')).textContent = localize('polvoWorkflowPropsTitle', "Propriedades do passo");
		dom.append(head, $('.polvo-workflow-props-type')).textContent = node.type;
		const closeBtn = dom.append(head, document.createElement('button'));
		closeBtn.className = 'polvo-workflow-props-close';
		closeBtn.type = 'button';
		closeBtn.appendChild(renderIcon(Codicon.close));
		this.propsDisposables.add(dom.addDisposableListener(closeBtn, dom.EventType.CLICK, () => this.onSelectNode(undefined)));

		const form = dom.append(this.propsPanel, $('.polvo-workflow-props-form'));
		const inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>();

		const labelInput = this.appendField(form, localize('polvoWorkflowPropsLabel', "Nome"), false);
		labelInput.value = typeof node.data?.label === 'string' ? node.data.label : '';
		inputs.set('label', labelInput);

		const specs = NODE_FIELD_SPECS[node.type] ?? [{ key: 'prompt', label: 'Prompt', multiline: true }];
		for (const spec of specs) {
			const field = this.appendField(form, spec.label, !!spec.multiline);
			const value = node.data?.[spec.key];
			field.value = typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value));
			inputs.set(spec.key, field);
		}

		const actions = dom.append(this.propsPanel, $('.polvo-workflow-props-actions'));
		const saveBtn = dom.append(actions, document.createElement('button'));
		saveBtn.className = 'polvo-workflow-props-save';
		saveBtn.type = 'button';
		saveBtn.textContent = localize('polvoWorkflowPropsSave', "Guardar passo");
		this.propsDisposables.add(dom.addDisposableListener(saveBtn, dom.EventType.CLICK, () => void this.saveNodeProps(node.id, inputs)));
	}

	private appendField(parent: HTMLElement, label: string, multiline: boolean): HTMLInputElement | HTMLTextAreaElement {
		const wrap = dom.append(parent, $('.polvo-workflow-props-field'));
		dom.append(wrap, $('label.polvo-workflow-props-field-label')).textContent = label;
		if (multiline) {
			const ta = document.createElement('textarea');
			ta.className = 'polvo-workflow-props-textarea';
			ta.rows = 3;
			wrap.appendChild(ta);
			return ta;
		}
		const input = document.createElement('input');
		input.type = 'text';
		input.className = 'polvo-workflow-props-input';
		wrap.appendChild(input);
		return input;
	}

	private async saveNodeProps(nodeId: string, inputs: Map<string, HTMLInputElement | HTMLTextAreaElement>): Promise<void> {
		if (!this.workflowId) {
			return;
		}
		const workflow = this.workflowsService.getWorkflow(this.workflowId);
		if (!workflow?.graph) {
			return;
		}
		const nextNodes = workflow.graph.nodes.map(node => {
			if (node.id !== nodeId) {
				return node;
			}
			const data: Record<string, unknown> = { ...(node.data ?? {}) };
			for (const [key, field] of inputs) {
				const value = field.value.trim();
				if (value) {
					data[key] = value;
				} else {
					delete data[key];
				}
			}
			return { ...node, data };
		});
		const nextGraph: IOpenPolvoWorkflowGraph = { nodes: nextNodes, edges: workflow.graph.edges };
		this.workflowsService.setGraph(this.workflowId, { graph: nextGraph });

		if (workflow.backendId) {
			try {
				await withOpenPolvoApiAuth(this.signInService, () => this.openPolvoApi.updateWorkflow(workflow.backendId!, { graph: nextGraph }), this.openPolvoApi);
			} catch (err) {
				this.logService.warn(`[OpenPolvo] Failed to persist workflow graph: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
		this.renderWorkflow();
	}
}
