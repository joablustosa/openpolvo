/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/polvoModes.css';
import './polvoWorkbenchModeService.js';
import './polvoModeNavigationService.js';
import './polvoModeCommands.js';
import './polvoSettingsCommands.js';
import './openpolvo.config.contribution.js';
import './openPolvoWorkbenchApiService.js';
import './openPolvoAuth.js';
import './openPolvoAgentHostAuthContribution.js';
import './openPolvoDevExplorerContribution.js';
import './openPolvoDevAgentPanel.js';
import './polvoAgentConversationsService.js';
import './polvoAgentChatContextService.js';
import './polvoAgentSelectionAffordance.js';
import './polvoAgentSelectionActions.js';
import './polvoAgentHistorySyncService.js';
import './polvoWorkflowsService.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { PolvoWorkbenchModeLayoutController } from './polvoWorkbenchModeLayoutController.js';
import { OpenPolvoAgentHostAuthContribution } from './openPolvoAgentHostAuthContribution.js';
import './polvoModeSwitcherMount.js';
import { IViewContainersRegistry, Extensions as ViewContainerExtensions, ViewContainerLocation, IViewsRegistry, ViewContainer } from '../../../common/views.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { POLVO_AGENT_VIEW_CONTAINER_ID, POLVO_WORKFLOW_VIEW_CONTAINER_ID } from '../common/polvoModes.js';
import { PolvoWorkflowNavView, POLVO_WORKFLOW_NAV_VIEW_ID } from './polvoWorkflowNavView.js';
import { PolvoAgentConversationsView, POLVO_AGENT_CONVERSATIONS_VIEW_ID } from './polvoAgentConversationsView.js';
import { EditorExtensions, IEditorFactoryRegistry } from '../../../common/editor.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { PolvoWorkflowEditor } from './polvoWorkflowEditor.js';
import { PolvoWorkflowEditorInput, PolvoWorkflowEditorInputSerializer } from './polvoWorkflowEditorInput.js';
import { PolvoAgentChatEditor } from './polvoAgentChatEditor.js';
import { PolvoAgentChatEditorInput, PolvoAgentChatEditorInputSerializer } from './polvoAgentChatEditorInput.js';

const viewContainerRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);
const viewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);

const agentViewContainer: ViewContainer = viewContainerRegistry.registerViewContainer({
	id: POLVO_AGENT_VIEW_CONTAINER_ID,
	title: localize2('polvoAgentViewContainer', "Agente"),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [POLVO_AGENT_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	icon: Codicon.agent,
	hideIfEmpty: true,
	order: 99,
}, ViewContainerLocation.Sidebar, { doNotRegisterOpenCommand: true });

viewsRegistry.registerViews([{
	id: POLVO_AGENT_CONVERSATIONS_VIEW_ID,
	name: localize2('polvoAgentConversations', "Conversas"),
	ctorDescriptor: new SyncDescriptor(PolvoAgentConversationsView),
	canToggleVisibility: false,
	canMoveView: false,
	order: 0,
}], agentViewContainer);

const workflowViewContainer: ViewContainer = viewContainerRegistry.registerViewContainer({
	id: POLVO_WORKFLOW_VIEW_CONTAINER_ID,
	title: localize2('polvoWorkflowViewContainer', "Automações"),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [POLVO_WORKFLOW_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	icon: Codicon.runAll,
	hideIfEmpty: true,
	order: 100,
}, ViewContainerLocation.Sidebar, { doNotRegisterOpenCommand: true });

viewsRegistry.registerViews([{
	id: POLVO_WORKFLOW_NAV_VIEW_ID,
	name: localize2('polvoWorkflowNav', "Automações"),
	ctorDescriptor: new SyncDescriptor(PolvoWorkflowNavView),
	canToggleVisibility: false,
	canMoveView: false,
	order: 0,
}], workflowViewContainer);

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		PolvoWorkflowEditor,
		PolvoWorkflowEditor.ID,
		localize('polvoWorkflowEditorPane', "Automações")
	),
	[new SyncDescriptor(PolvoWorkflowEditorInput)]
);

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	PolvoWorkflowEditorInput.TypeID,
	PolvoWorkflowEditorInputSerializer
);

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		PolvoAgentChatEditor,
		PolvoAgentChatEditor.ID,
		localize('polvoAgentChatEditorPane', "Agente")
	),
	[new SyncDescriptor(PolvoAgentChatEditorInput)]
);

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	PolvoAgentChatEditorInput.TypeID,
	PolvoAgentChatEditorInputSerializer
);

registerWorkbenchContribution2(PolvoWorkbenchModeLayoutController.ID, PolvoWorkbenchModeLayoutController, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(OpenPolvoAgentHostAuthContribution.ID, OpenPolvoAgentHostAuthContribution, WorkbenchPhase.AfterRestored);

/** Carrega o bootstrap Ollama de forma assíncrona para não bloquear o workbench se o módulo falhar. */
class OpenPolvoLocalLlmSetupContributionLoader extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.openPolvoLocalLlmSetup';

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		void import('./openPolvoLocalLlmSetupContribution.js').then(module => {
			this._register(this.instantiationService.createInstance(module.OpenPolvoLocalLlmSetupContribution));
		}).catch(err => {
			this.logService.error('[OpenPolvo] Falha ao carregar bootstrap de IA local', err);
		});
	}
}

registerWorkbenchContribution2(OpenPolvoLocalLlmSetupContributionLoader.ID, OpenPolvoLocalLlmSetupContributionLoader, WorkbenchPhase.Eventually);
