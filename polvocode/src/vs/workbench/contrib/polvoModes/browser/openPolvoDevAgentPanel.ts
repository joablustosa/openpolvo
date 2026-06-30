/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IAgentHostService } from '../../../../platform/agentHost/common/agentService.js';
import { ActionType } from '../../../../platform/agentHost/common/state/sessionActions.js';

/**
 * Painel Dev Agent — timeline de eventos do workflow (progresso incremental).
 */
export class OpenPolvoDevAgentPanelContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.openPolvoDevAgentPanel';

	private readonly _events: Array<{ step: string; label: string; at: number }> = [];

	constructor(
		@IAgentHostService private readonly agentHostService: IAgentHostService,
	) {
		super();
		this._register(this.agentHostService.onDidAction(envelope => {
			if (envelope.action.type !== ActionType.ChatToolCallComplete) {
				return;
			}
			const ui = envelope.action._meta?.ui;
			if (ui?.toolName === 'dev_workflow_step' && envelope.action.result?.success) {
				const label = envelope.action.result.pastTenseMessage ?? '';
				const step = typeof ui.step === 'string' ? ui.step : 'dev_step';
				this._events.push({ step, label, at: Date.now() });
			}
		}));
	}

	getRecentEvents(): readonly { step: string; label: string; at: number }[] {
		return this._events;
	}
}

registerWorkbenchContribution2(
	OpenPolvoDevAgentPanelContribution.ID,
	OpenPolvoDevAgentPanelContribution,
	WorkbenchPhase.AfterRestored,
);
