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
import { ILogService } from '../../../../platform/log/common/log.js';
import { localize } from '../../../../nls.js';
import { IPolvoConversationMessage } from './polvoAgentConversationsService.js';
import { IOpenPolvoWorkbenchApiService, IOpenPolvoWorkflowGraph, IWorkflowStepBlueprint } from './openPolvoWorkbenchApiService.js';

export const POLVO_WORKFLOW_SCHEME = 'polvo-workflow';

export interface IPolvoWorkflow {
	readonly id: string;
	readonly resource: URI;
	title: string;
	readonly messages: IPolvoConversationMessage[];
	modelId: string;
	apiSessionId?: string;
	summary?: string;
	/** UUID do workflow persistido no backend (`/v1/workflows`). */
	backendId?: string;
	/** Grafo React Flow (nós + arestas) do agente. */
	graph?: IOpenPolvoWorkflowGraph;
	description?: string;
	/** Plano de passos com prompt por nó devolvido pelo agente especialista. */
	stepBlueprint?: IWorkflowStepBlueprint[];
}

export interface IPolvoWorkflowGraphUpdate {
	graph: IOpenPolvoWorkflowGraph;
	backendId?: string;
	stepBlueprint?: IWorkflowStepBlueprint[];
	description?: string;
	title?: string;
}

export const IPolvoWorkflowsService = createDecorator<IPolvoWorkflowsService>('polvoWorkflowsService');

export interface IPolvoWorkflowsService {
	readonly _serviceBrand: undefined;

	readonly workflows: readonly IPolvoWorkflow[];
	readonly activeWorkflowId: string | undefined;
	readonly onDidChangeWorkflows: Event<void>;
	readonly onDidChangeActiveWorkflow: Event<string | undefined>;

	createWorkflow(initialPrompt?: string): IPolvoWorkflow;
	setActiveWorkflow(id: string | undefined): void;
	getWorkflow(id: string): IPolvoWorkflow | undefined;
	addMessage(workflowId: string, role: 'user' | 'assistant', content: string): void;
	setWorkflowModel(workflowId: string, modelId: string): void;
	setApiSessionId(workflowId: string, apiSessionId: string): void;
	updateAssistantMessage(workflowId: string, content: string, extras?: { responseTimeSeconds?: number }): void;
	setSummary(workflowId: string, summary: string): void;
	setGraph(workflowId: string, update: IPolvoWorkflowGraphUpdate): void;
	deleteWorkflow(workflowId: string): boolean;
	/** Sincroniza a lista local com os workflows persistidos no backend. */
	loadFromBackend(): Promise<void>;
}

const STORAGE_KEY = 'polvo.workflows';

interface IStoredWorkflow {
	id: string;
	title: string;
	messages: IPolvoConversationMessage[];
	modelId?: string;
	apiSessionId?: string;
	summary?: string;
	backendId?: string;
	graph?: IOpenPolvoWorkflowGraph;
	description?: string;
	stepBlueprint?: IWorkflowStepBlueprint[];
}

export class PolvoWorkflowsService extends Disposable implements IPolvoWorkflowsService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeWorkflows = this._register(new Emitter<void>());
	readonly onDidChangeWorkflows = this._onDidChangeWorkflows.event;

	private readonly _onDidChangeActiveWorkflow = this._register(new Emitter<string | undefined>());
	readonly onDidChangeActiveWorkflow = this._onDidChangeActiveWorkflow.event;

	private _workflows: IPolvoWorkflow[] = [];
	private _activeWorkflowId: string | undefined;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IOpenPolvoWorkbenchApiService private readonly apiService: IOpenPolvoWorkbenchApiService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.restore();
	}

	get workflows(): readonly IPolvoWorkflow[] {
		return this._workflows;
	}

	get activeWorkflowId(): string | undefined {
		return this._activeWorkflowId;
	}

	createWorkflow(initialPrompt?: string): IPolvoWorkflow {
		const id = generateUuid();
		const title = initialPrompt
			? (initialPrompt.length > 40 ? `${initialPrompt.slice(0, 40)}…` : initialPrompt)
			: localize('polvoNewWorkflow', "Nova automação");
		const workflow: IPolvoWorkflow = {
			id,
			resource: URI.from({ scheme: POLVO_WORKFLOW_SCHEME, path: id }),
			title,
			messages: [],
			modelId: 'polvo',
		};
		this._workflows.unshift(workflow);
		this._activeWorkflowId = id;
		this.persist();
		this._onDidChangeWorkflows.fire();
		this._onDidChangeActiveWorkflow.fire(id);
		return workflow;
	}

	setActiveWorkflow(id: string | undefined): void {
		if (this._activeWorkflowId === id) {
			return;
		}
		this._activeWorkflowId = id;
		this._onDidChangeActiveWorkflow.fire(id);
	}

	getWorkflow(id: string): IPolvoWorkflow | undefined {
		return this._workflows.find(w => w.id === id || w.resource.path === id);
	}

	addMessage(workflowId: string, role: 'user' | 'assistant', content: string): void {
		const workflow = this.getWorkflow(workflowId);
		if (!workflow) {
			return;
		}
		workflow.messages.push({ role, content });
		if (role === 'user' && workflow.title === localize('polvoNewWorkflow', "Nova automação")) {
			workflow.title = content.length > 40 ? `${content.slice(0, 40)}…` : content;
		}
		this.persist();
		this._onDidChangeWorkflows.fire();
	}

	setWorkflowModel(workflowId: string, modelId: string): void {
		const workflow = this.getWorkflow(workflowId);
		if (!workflow || workflow.modelId === modelId) {
			return;
		}
		workflow.modelId = modelId;
		this.persist();
		this._onDidChangeWorkflows.fire();
	}

	setApiSessionId(workflowId: string, apiSessionId: string): void {
		const workflow = this.getWorkflow(workflowId);
		if (!workflow) {
			return;
		}
		workflow.apiSessionId = apiSessionId;
		this.persist();
	}

	updateAssistantMessage(workflowId: string, content: string, extras?: { responseTimeSeconds?: number }): void {
		const workflow = this.getWorkflow(workflowId);
		if (!workflow) {
			return;
		}
		const last = workflow.messages[workflow.messages.length - 1];
		if (last?.role === 'assistant') {
			last.content = content;
			if (extras?.responseTimeSeconds !== undefined) {
				last.responseTimeSeconds = extras.responseTimeSeconds;
			}
		} else {
			workflow.messages.push({ role: 'assistant', content, responseTimeSeconds: extras?.responseTimeSeconds });
		}
		this.persist();
		this._onDidChangeWorkflows.fire();
	}

	setSummary(workflowId: string, summary: string): void {
		const workflow = this.getWorkflow(workflowId);
		if (!workflow) {
			return;
		}
		workflow.summary = summary;
		this.persist();
		this._onDidChangeWorkflows.fire();
	}

	setGraph(workflowId: string, update: IPolvoWorkflowGraphUpdate): void {
		const workflow = this.getWorkflow(workflowId);
		if (!workflow) {
			return;
		}
		workflow.graph = update.graph;
		if (update.backendId) {
			workflow.backendId = update.backendId;
		}
		if (update.stepBlueprint) {
			workflow.stepBlueprint = update.stepBlueprint;
		}
		if (update.description) {
			workflow.description = update.description;
		}
		if (update.title) {
			workflow.title = update.title;
		}
		this.persist();
		this._onDidChangeWorkflows.fire();
	}

	async loadFromBackend(): Promise<void> {
		this.repairWorkflowResources();
		let records;
		try {
			records = await this.apiService.listWorkflows();
		} catch (err) {
			this.logService.warn(`[OpenPolvo] Failed to sync workflows: ${err instanceof Error ? err.message : String(err)}`);
			return;
		}
		let changed = false;
		for (const record of records) {
			const existing = this._workflows.find(w => w.backendId === record.id);
			if (existing) {
				existing.graph = record.graph;
				if (record.title) {
					existing.title = record.title;
				}
				changed = true;
				continue;
			}
			const id = generateUuid();
			this._workflows.push({
				id,
				resource: URI.from({ scheme: POLVO_WORKFLOW_SCHEME, path: id }),
				title: record.title,
				messages: [],
				modelId: 'polvo',
				backendId: record.id,
				graph: record.graph,
			});
			changed = true;
		}
		if (changed) {
			if (!this._activeWorkflowId) {
				this._activeWorkflowId = this._workflows[0]?.id;
				this._onDidChangeActiveWorkflow.fire(this._activeWorkflowId);
			}
			this.persist();
			this._onDidChangeWorkflows.fire();
		}
	}

	deleteWorkflow(workflowId: string): boolean {
		const index = this._workflows.findIndex(w => w.id === workflowId);
		if (index === -1) {
			return false;
		}
		this._workflows.splice(index, 1);
		if (this._activeWorkflowId === workflowId) {
			this._activeWorkflowId = this._workflows[0]?.id;
			this._onDidChangeActiveWorkflow.fire(this._activeWorkflowId);
		}
		this.persist();
		this._onDidChangeWorkflows.fire();
		return true;
	}

	private repairWorkflowResources(): void {
		this._workflows = this._workflows.map(workflow => {
			if (workflow.resource.path === workflow.id) {
				return workflow;
			}
			return {
				...workflow,
				resource: URI.from({ scheme: POLVO_WORKFLOW_SCHEME, path: workflow.id }),
			};
		});
	}

	private restore(): void {
		const raw = this.storageService.get(STORAGE_KEY, StorageScope.WORKSPACE);
		if (!raw) {
			return;
		}
		try {
			const stored = JSON.parse(raw) as IStoredWorkflow[];
			this._workflows = stored.map(item => ({
				id: item.id,
				resource: URI.from({ scheme: POLVO_WORKFLOW_SCHEME, path: item.id }),
				title: item.title,
				messages: item.messages,
				modelId: item.modelId ?? 'polvo',
				apiSessionId: item.apiSessionId,
				summary: item.summary,
				backendId: item.backendId,
				graph: item.graph,
				description: item.description,
				stepBlueprint: item.stepBlueprint,
			}));
			this.repairWorkflowResources();
			this._activeWorkflowId = this._workflows[0]?.id;
		} catch {
			this._workflows = [];
		}
	}

	private persist(): void {
		const stored: IStoredWorkflow[] = this._workflows.map(w => ({
			id: w.id,
			title: w.title,
			messages: w.messages,
			modelId: w.modelId,
			apiSessionId: w.apiSessionId,
			summary: w.summary,
			backendId: w.backendId,
			graph: w.graph,
			description: w.description,
			stepBlueprint: w.stepBlueprint,
		}));
		this.storageService.store(STORAGE_KEY, JSON.stringify(stored), StorageScope.WORKSPACE, StorageTarget.USER);
	}
}

registerSingleton(IPolvoWorkflowsService, PolvoWorkflowsService, InstantiationType.Delayed);
