/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { timeout } from '../../../../base/common/async.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { Parts, IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { IPolvoWorkbenchModeService, PolvoWorkbenchMode } from '../common/polvoWorkbenchMode.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IPaneCompositePartService } from '../../../services/panecomposite/browser/panecomposite.js';
import { ViewContainerLocation } from '../../../common/views.js';
import { VIEWLET_ID } from '../../files/common/files.js';
import { POLVO_AGENT_VIEW_CONTAINER_ID, POLVO_WORKFLOW_VIEW_CONTAINER_ID } from '../common/polvoModes.js';
import { PolvoWorkflowEditorInput } from './polvoWorkflowEditorInput.js';
import { IPolvoWorkflowsService } from './polvoWorkflowsService.js';
import { IPolvoAgentConversationsService } from './polvoAgentConversationsService.js';
import { PolvoAgentChatEditorInput } from './polvoAgentChatEditorInput.js';
import { IPolvoModeNavigationService } from './polvoModeNavigationService.js';

export class PolvoWorkbenchModeLayoutController extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.polvoWorkbenchModeLayout';

	private lastAppliedMode: PolvoWorkbenchMode | undefined;
	private isReady = false;
	private pendingMode: PolvoWorkbenchMode | undefined;

	constructor(
		@IPolvoWorkbenchModeService private readonly modeService: IPolvoWorkbenchModeService,
		@IPolvoModeNavigationService private readonly navigationService: IPolvoModeNavigationService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IEditorService private readonly editorService: IEditorService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IPaneCompositePartService private readonly paneCompositeService: IPaneCompositePartService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this._register(this.navigationService.registerLayoutApplier(mode => this.applyMode(mode)));
		this._register(this.modeService.onDidChangeMode(mode => {
			if (!this.isReady) {
				this.pendingMode = mode;
			}
		}));
		void this.initializeWhenReady();
	}

	private async initializeWhenReady(): Promise<void> {
		try {
			await this.editorGroupsService.whenReady;
			await timeout(250);
			this.isReady = true;
			const mode = this.pendingMode ?? this.modeService.mode;
			this.pendingMode = undefined;
			await this.applyMode(mode);
		} catch (error) {
			onUnexpectedError(error);
		}
	}

	private syncModeClass(mode: PolvoWorkbenchMode): void {
		const container = this.layoutService.getContainer(mainWindow);
		if (!container) {
			return;
		}
		container.classList.remove('polvo-mode-code', 'polvo-mode-agent', 'polvo-mode-workflow');
		container.classList.add(`polvo-mode-${mode}`);
	}

	private async applyMode(mode: PolvoWorkbenchMode): Promise<void> {
		if (!this.isReady) {
			return;
		}

		this.syncModeClass(mode);

		try {
			switch (mode) {
				case PolvoWorkbenchMode.Agent:
					await this.enterAgentMode();
					break;
				case PolvoWorkbenchMode.Workflow:
					await this.enterWorkflowMode();
					break;
				case PolvoWorkbenchMode.Code:
					await this.enterCodeMode();
					break;
			}
			this.lastAppliedMode = mode;
		} catch (error) {
			this.logService.error('[PolvoModes] Failed to apply workbench mode', error);
			onUnexpectedError(error);
		}
	}

	private async enterAgentMode(): Promise<void> {
		await this.closePolvoModeEditors(PolvoWorkbenchMode.Agent);

		this.layoutService.setPartHidden(true, Parts.ACTIVITYBAR_PART);
		this.layoutService.setPartHidden(true, Parts.AUXILIARYBAR_PART);
		this.layoutService.setPartHidden(false, Parts.SIDEBAR_PART);
		this.layoutService.setPartHidden(false, Parts.EDITOR_PART);

		await this.paneCompositeService.openPaneComposite(POLVO_AGENT_VIEW_CONTAINER_ID, ViewContainerLocation.Sidebar, true);

		const conversationsService = this.instantiationService.invokeFunction(accessor => accessor.get(IPolvoAgentConversationsService));
		let conversation = conversationsService.activeConversationId
			? conversationsService.getConversation(conversationsService.activeConversationId)
			: undefined;
		if (!conversation) {
			conversation = conversationsService.createConversation();
		}

		const input = new PolvoAgentChatEditorInput(conversation.resource);
		await this.editorService.openEditor(input, { pinned: true, revealIfOpened: true });
	}

	private async enterWorkflowMode(): Promise<void> {
		await this.closePolvoModeEditors(PolvoWorkbenchMode.Workflow);

		this.layoutService.setPartHidden(true, Parts.ACTIVITYBAR_PART);
		this.layoutService.setPartHidden(true, Parts.AUXILIARYBAR_PART);
		this.layoutService.setPartHidden(false, Parts.SIDEBAR_PART);
		this.layoutService.setPartHidden(false, Parts.EDITOR_PART);

		await this.paneCompositeService.openPaneComposite(POLVO_WORKFLOW_VIEW_CONTAINER_ID, ViewContainerLocation.Sidebar, true);

		const workflowsService = this.instantiationService.invokeFunction(accessor => accessor.get(IPolvoWorkflowsService));
		const active = workflowsService.activeWorkflowId
			? workflowsService.getWorkflow(workflowsService.activeWorkflowId)
			: workflowsService.workflows[0];
		if (active) {
			const input = new PolvoWorkflowEditorInput(active.resource);
			await this.editorService.openEditor(input, { pinned: true, revealIfOpened: true });
		}
	}

	private async enterCodeMode(): Promise<void> {
		this.layoutService.setPartHidden(false, Parts.ACTIVITYBAR_PART);
		this.layoutService.setPartHidden(false, Parts.AUXILIARYBAR_PART);
		this.layoutService.setPartHidden(false, Parts.SIDEBAR_PART);
		this.layoutService.setPartHidden(false, Parts.EDITOR_PART);

		if (this.lastAppliedMode && this.lastAppliedMode !== PolvoWorkbenchMode.Code) {
			await this.paneCompositeService.openPaneComposite(VIEWLET_ID, ViewContainerLocation.Sidebar, false);
			await this.closePolvoModeEditors();
		}
	}

	private async closePolvoModeEditors(keep?: PolvoWorkbenchMode): Promise<void> {
		const toClose = [];
		for (const group of this.editorGroupsService.groups) {
			for (const editor of group.editors) {
				const isAgent = editor instanceof PolvoAgentChatEditorInput;
				const isWorkflow = editor instanceof PolvoWorkflowEditorInput;
				if (!isAgent && !isWorkflow) {
					continue;
				}
				if (keep === PolvoWorkbenchMode.Agent && isAgent) {
					continue;
				}
				if (keep === PolvoWorkbenchMode.Workflow && isWorkflow) {
					continue;
				}
				toClose.push({ editor, groupId: group.id });
			}
		}
		if (toClose.length > 0) {
			await this.editorService.closeEditors(toClose);
		}
	}
}
