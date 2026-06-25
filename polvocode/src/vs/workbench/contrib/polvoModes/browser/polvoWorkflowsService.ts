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
import { IPolvoConversationMessage } from './polvoAgentConversationsService.js';

export const POLVO_WORKFLOW_SCHEME = 'polvo-workflow';

export interface IPolvoWorkflow {
	readonly id: string;
	readonly resource: URI;
	title: string;
	readonly messages: IPolvoConversationMessage[];
	modelId: string;
	apiSessionId?: string;
	summary?: string;
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
	updateAssistantMessage(workflowId: string, content: string): void;
	setSummary(workflowId: string, summary: string): void;
	deleteWorkflow(workflowId: string): boolean;
}

const STORAGE_KEY = 'polvo.workflows';

interface IStoredWorkflow {
	id: string;
	title: string;
	messages: IPolvoConversationMessage[];
	modelId?: string;
	apiSessionId?: string;
	summary?: string;
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
		return this._workflows.find(w => w.id === id);
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

	updateAssistantMessage(workflowId: string, content: string): void {
		const workflow = this.getWorkflow(workflowId);
		if (!workflow) {
			return;
		}
		const last = workflow.messages[workflow.messages.length - 1];
		if (last?.role === 'assistant') {
			last.content = content;
		} else {
			workflow.messages.push({ role: 'assistant', content });
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
			}));
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
		}));
		this.storageService.store(STORAGE_KEY, JSON.stringify(stored), StorageScope.WORKSPACE, StorageTarget.USER);
	}
}

registerSingleton(IPolvoWorkflowsService, PolvoWorkflowsService, InstantiationType.Delayed);
