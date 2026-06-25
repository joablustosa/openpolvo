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
import { localize } from '../../../../nls.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { PolvoWorkflowEditorInput } from './polvoWorkflowEditorInput.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IPolvoWorkflowsService } from './polvoWorkflowsService.js';
import { IOpenPolvoModel, IOpenPolvoWorkbenchApiService } from './openPolvoWorkbenchApiService.js';
import { sendPolvoWorkflowMessage } from './polvoWorkflowMessaging.js';
import { OpenPolvoWorkflowsBackendSettingId } from '../common/openpolvoConfiguration.js';

const $ = dom.$;

export class PolvoWorkflowEditor extends EditorPane {
	static readonly ID = PolvoWorkflowEditorInput.EditorID;

	private container: HTMLElement | undefined;
	private messagesInner: HTMLElement | undefined;
	private summaryElement: HTMLElement | undefined;
	private inputElement: HTMLTextAreaElement | undefined;
	private modelLabelElement: HTMLElement | undefined;
	private modelChip: HTMLButtonElement | undefined;
	private sendButton: HTMLButtonElement | undefined;
	private workflowId: string | undefined;
	private models: IOpenPolvoModel[] = [];
	private isSending = false;
	private abortController: AbortController | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IPolvoWorkflowsService private readonly workflowsService: IPolvoWorkflowsService,
		@IOpenPolvoWorkbenchApiService private readonly openPolvoApi: IOpenPolvoWorkbenchApiService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super(PolvoWorkflowEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.container = dom.append(parent, $('.polvo-workflow-editor'));
		const inner = dom.append(this.container, $('.polvo-workflow-editor-inner'));

		const heading = dom.append(inner, document.createElement('h1'));
		heading.textContent = localize('polvoWorkflowTitle', "Automações");

		this.summaryElement = dom.append(inner, document.createElement('p'));
		this.summaryElement.className = 'subtitle';

		const messagesArea = dom.append(inner, $('.polvo-workflow-messages'));
		this.messagesInner = dom.append(messagesArea, $('.polvo-workflow-messages-inner'));

		const composer = dom.append(inner, $('.polvo-agent-chat-composer.polvo-workflow-editor-composer'));
		const composerInner = dom.append(composer, $('.polvo-agent-chat-composer-inner'));
		const composerBox = dom.append(composerInner, $('.polvo-agent-chat-composer-box'));

		this.inputElement = document.createElement('textarea');
		this.inputElement.className = 'polvo-agent-chat-input';
		this.inputElement.placeholder = localize('polvoWorkflowRefinePlaceholder', "Refine este workflow em linguagem natural...");
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

		this._register(this.workflowsService.onDidChangeWorkflows(() => this.renderWorkflow()));
		this._register(this.workflowsService.onDidChangeActiveWorkflow(() => this.renderWorkflow()));

		void this.loadModels();
	}

	override async setInput(input: PolvoWorkflowEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this.workflowId = input.resource.path;
		this.workflowsService.setActiveWorkflow(this.workflowId);
		this.renderWorkflow();
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
		this.abortController?.abort();
		this.abortController = new AbortController();
		try {
			await sendPolvoWorkflowMessage(this.workflowsService, this.openPolvoApi, this.workflowId, text, {
				useBackend: this.configurationService.getValue<boolean>(OpenPolvoWorkflowsBackendSettingId) !== false,
				signal: this.abortController.signal,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.workflowsService.addMessage(this.workflowId, 'assistant', localize('polvoWorkflowApiError', "Não foi possível contactar a API OpenPolvo: {0}", message));
		} finally {
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
		if (!this.messagesInner || !this.summaryElement || !this.workflowId) {
			return;
		}
		const workflow = this.workflowsService.getWorkflow(this.workflowId);
		if (!workflow) {
			return;
		}

		this.summaryElement.textContent = workflow.summary
			?? localize('polvoWorkflowSubtitle', "Descreva ou refine este fluxo de trabalho em linguagem natural.");

		dom.clearNode(this.messagesInner);
		for (const message of workflow.messages) {
			const messageEl = dom.append(this.messagesInner, $('.polvo-agent-chat-message'));
			messageEl.classList.add(message.role);
			const bubble = dom.append(messageEl, $('.polvo-agent-chat-bubble'));
			bubble.textContent = message.content;
		}
		this.updateModelLabel();
	}
}
