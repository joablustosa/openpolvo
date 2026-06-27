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
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IPolvoWorkflowsService } from './polvoWorkflowsService.js';
import { PolvoWorkflowEditorInput } from './polvoWorkflowEditorInput.js';
import { IOpenPolvoModel, IOpenPolvoWorkbenchApiService } from './openPolvoWorkbenchApiService.js';
import { IOpenPolvoSignInService } from './openPolvoAuth.js';
import { withOpenPolvoApiAuth } from './openPolvoApiAuthHelper.js';
import { sendPolvoWorkflowMessage } from './polvoWorkflowMessaging.js';
import { OpenPolvoWorkflowsBackendSettingId } from '../common/openpolvoConfiguration.js';

const $ = dom.$;

export const POLVO_WORKFLOW_NAV_VIEW_ID = 'polvo.workflow.navView';

export class PolvoWorkflowNavView extends ViewPane {

	private listContainer: HTMLElement | undefined;
	private inputElement: HTMLTextAreaElement | undefined;
	private modelLabelElement: HTMLElement | undefined;
	private modelChip: HTMLButtonElement | undefined;
	private sendButton: HTMLButtonElement | undefined;
	private models: IOpenPolvoModel[] = [];
	private isSending = false;
	private abortController: AbortController | undefined;
	private selectedModelId = 'polvo';

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IPolvoWorkflowsService private readonly workflowsService: IPolvoWorkflowsService,
		@IEditorService private readonly editorService: IEditorService,
		@IOpenPolvoWorkbenchApiService private readonly openPolvoApi: IOpenPolvoWorkbenchApiService,
		@IOpenPolvoSignInService private readonly signInService: IOpenPolvoSignInService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		container.classList.add('polvo-workflow-nav-view');

		this.listContainer = dom.append(container, $('.polvo-workflow-nav-list'));

		const composerHost = dom.append(container, $('.polvo-workflow-nav-composer'));
		const composerInner = dom.append(composerHost, $('.polvo-agent-chat-composer-inner'));
		const composerBox = dom.append(composerInner, $('.polvo-agent-chat-composer-box'));

		this.inputElement = document.createElement('textarea');
		this.inputElement.className = 'polvo-agent-chat-input';
		this.inputElement.placeholder = localize('polvoWorkflowCreatePlaceholder', "Descreva o workflow que deseja criar...");
		this.inputElement.rows = 3;
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
		this.sendButton.title = localize('polvoWorkflowCreate', "Criar workflow");
		this.sendButton.appendChild(renderIcon(Codicon.arrowUp));
		footerRight.appendChild(this.sendButton);

		this._register(dom.addDisposableListener(this.sendButton, dom.EventType.CLICK, () => void this.createWorkflowFromPrompt()));
		this._register(dom.addDisposableListener(this.modelChip, dom.EventType.CLICK, e => this.showModelPicker(e)));
		this._register(dom.addDisposableListener(this.inputElement, dom.EventType.INPUT, () => this.autoResizeInput()));
		this._register(dom.addDisposableListener(this.inputElement, dom.EventType.KEY_DOWN, e => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				void this.createWorkflowFromPrompt();
			}
		}));

		this._register(this.workflowsService.onDidChangeWorkflows(() => this.renderList()));
		this._register(this.workflowsService.onDidChangeActiveWorkflow(() => this.renderList()));
		this._register(this.editorService.onDidActiveEditorChange(() => this.renderList()));

		this._register(dom.addDisposableListener(this.listContainer, dom.EventType.CLICK, e => {
			const target = e.target as HTMLElement;
			const optionsBtn = target.closest('.polvo-conversation-options');
			if (optionsBtn instanceof HTMLElement) {
				e.preventDefault();
				e.stopPropagation();
				const workflowId = optionsBtn.dataset.workflowId;
				if (workflowId) {
					this.showWorkflowOptions(workflowId, e);
				}
				return;
			}
			const item = target.closest('.polvo-conversation-item');
			if (item instanceof HTMLElement) {
				const workflowId = item.dataset.workflowId;
				if (workflowId) {
					void this.openWorkflow(workflowId);
				}
			}
		}));

		void this.signInService.ensureSignedIn().then(async () => {
			await this.loadModels();
			await this.workflowsService.loadFromBackend();
			this.renderList();
		});
		this.renderList();
	}

	private async loadModels(): Promise<void> {
		this.models = await withOpenPolvoApiAuth(this.signInService, () => this.openPolvoApi.listModels());
		const model = this.models.find(m => m.id === this.selectedModelId) ?? this.models[0];
		this.selectedModelId = model?.id ?? 'polvo';
		if (this.modelLabelElement) {
			this.modelLabelElement.textContent = model?.name ?? localize('polvoAgentDefaultModel', "Polvo");
		}
	}

	private showModelPicker(e: MouseEvent): void {
		if (this.models.length === 0) {
			void this.loadModels().then(() => this.showModelPicker(e));
			return;
		}
		this.contextMenuService.showContextMenu({
			getAnchor: () => ({ x: e.clientX, y: e.clientY }),
			getActions: () => this.models.map(model => {
				const action = new Action(`polvo-wf-nav-model-${model.id}`, model.name, undefined, true, () => {
					this.selectedModelId = model.id;
					if (this.modelLabelElement) {
						this.modelLabelElement.textContent = model.name;
					}
					const activeId = this.workflowsService.activeWorkflowId;
					if (activeId) {
						this.workflowsService.setWorkflowModel(activeId, model.id);
					}
				});
				action.checked = model.id === this.selectedModelId;
				return action;
			}),
		});
	}

	private renderList(): void {
		if (!this.listContainer) {
			return;
		}
		dom.clearNode(this.listContainer);

		if (this.workflowsService.workflows.length === 0) {
			const empty = dom.append(this.listContainer, $('.polvo-workflow-nav-empty'));
			empty.textContent = localize('polvoWorkflowNavEmpty', "Nenhum workflow ainda. Use o campo abaixo para criar um.");
			return;
		}

		const activeEditor = this.editorService.activeEditor;
		const activeWorkflowId = activeEditor instanceof PolvoWorkflowEditorInput
			? activeEditor.resource.path
			: this.workflowsService.activeWorkflowId;

		for (const workflow of this.workflowsService.workflows) {
			const item = dom.append(this.listContainer, $('.polvo-conversation-item'));
			item.dataset.workflowId = workflow.id;
			item.classList.toggle('active', workflow.id === activeWorkflowId);

			const icon = dom.append(item, $('.conversation-icon'));
			icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.runAll));

			const textWrap = dom.append(item, $('.polvo-workflow-nav-item-text'));
			const titleRow = dom.append(textWrap, $('.polvo-workflow-nav-item-title-row'));
			const title = dom.append(titleRow, $('.title'));
			title.textContent = workflow.title;
			const stepCount = workflow.graph?.nodes?.length ?? 0;
			if (stepCount > 0) {
				const badge = dom.append(titleRow, $('.polvo-workflow-nav-badge'));
				badge.textContent = localize('polvoWorkflowStepBadge', "{0} passos", stepCount);
			}
			const subtitle = workflow.summary ?? workflow.description;
			if (subtitle) {
				const summary = dom.append(textWrap, $('.polvo-workflow-nav-summary'));
				summary.textContent = subtitle;
			}

			const optionsButton = document.createElement('button');
			optionsButton.className = 'polvo-conversation-options';
			optionsButton.type = 'button';
			optionsButton.dataset.workflowId = workflow.id;
			optionsButton.title = localize('polvoWorkflowOptions', "Opções do workflow");
			optionsButton.setAttribute('aria-label', localize('polvoWorkflowOptions', "Opções do workflow"));
			optionsButton.appendChild(renderIcon(Codicon.ellipsis));
			item.appendChild(optionsButton);
		}
	}

	private showWorkflowOptions(workflowId: string, e: MouseEvent): void {
		this.contextMenuService.showContextMenu({
			getAnchor: () => ({ x: e.clientX, y: e.clientY }),
			getActions: () => [
				new Action(
					'polvo.workflow.view',
					localize('polvoViewWorkflow', "Visualizar"),
					undefined,
					true,
					() => void this.openWorkflow(workflowId),
				),
				new Action(
					'polvo.workflow.delete',
					localize('polvoDeleteWorkflow', "Excluir"),
					undefined,
					true,
					() => void this.deleteWorkflow(workflowId),
				),
			],
		});
	}

	private async deleteWorkflow(workflowId: string): Promise<void> {
		const workflow = this.workflowsService.getWorkflow(workflowId);
		if (!workflow) {
			return;
		}
		const editors = this.editorService.findEditors(workflow.resource);
		if (editors.length > 0) {
			await this.editorService.closeEditors(editors);
		}
		this.workflowsService.deleteWorkflow(workflowId);
		const next = this.workflowsService.workflows[0];
		if (next) {
			await this.openWorkflow(next.id);
		}
		this.renderList();
	}

	private async openWorkflow(workflowId: string): Promise<void> {
		const workflow = this.workflowsService.getWorkflow(workflowId);
		if (!workflow) {
			return;
		}
		this.workflowsService.setActiveWorkflow(workflowId);
		await this.editorService.openEditor(new PolvoWorkflowEditorInput(workflow.resource), { pinned: true, revealIfOpened: true });
	}

	private async createWorkflowFromPrompt(): Promise<void> {
		if (!this.inputElement || this.isSending) {
			return;
		}
		const text = this.inputElement.value.trim();
		if (!text) {
			return;
		}

		const workflow = this.workflowsService.createWorkflow(text);
		this.workflowsService.setWorkflowModel(workflow.id, this.selectedModelId);
		this.inputElement.value = '';
		this.autoResizeInput();
		this.setSending(true);
		this.abortController?.abort();
		this.abortController = new AbortController();

		try {
			await this.editorService.openEditor(new PolvoWorkflowEditorInput(workflow.resource), { pinned: true });
			await withOpenPolvoApiAuth(this.signInService, () =>
				sendPolvoWorkflowMessage(this.workflowsService, this.openPolvoApi, workflow.id, text, {
					useBackend: this.configurationService.getValue<boolean>(OpenPolvoWorkflowsBackendSettingId) !== false,
					signal: this.abortController!.signal,
				})
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.workflowsService.addMessage(workflow.id, 'assistant', localize('polvoWorkflowApiError', "Não foi possível contactar a API OpenPolvo: {0}", message));
		} finally {
			this.setSending(false);
			this.renderList();
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

	private autoResizeInput(): void {
		if (!this.inputElement) {
			return;
		}
		this.inputElement.style.height = 'auto';
		const next = Math.min(this.inputElement.scrollHeight, 160);
		this.inputElement.style.height = `${Math.max(next, 56)}px`;
	}
}
