/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { PolvoWorkbenchMode } from '../common/polvoWorkbenchMode.js';
import { IPolvoModeNavigationService } from './polvoModeNavigationService.js';

export const POLVO_OPEN_AGENT_MODE_COMMAND_ID = 'polvo.modes.openAgent';
export const POLVO_OPEN_WORKFLOW_MODE_COMMAND_ID = 'polvo.modes.openWorkflow';
export const POLVO_OPEN_CODE_MODE_COMMAND_ID = 'polvo.modes.openCode';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: POLVO_OPEN_AGENT_MODE_COMMAND_ID,
			title: localize('polvoOpenAgentMode', "Abrir modo Agente"),
			f1: false,
		});
	}
	run(accessor: ServicesAccessor): Promise<void> {
		return accessor.get(IPolvoModeNavigationService).navigateTo(PolvoWorkbenchMode.Agent);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: POLVO_OPEN_WORKFLOW_MODE_COMMAND_ID,
			title: localize('polvoOpenWorkflowMode', "Abrir modo Workflow"),
			f1: false,
		});
	}
	run(accessor: ServicesAccessor): Promise<void> {
		return accessor.get(IPolvoModeNavigationService).navigateTo(PolvoWorkbenchMode.Workflow);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: POLVO_OPEN_CODE_MODE_COMMAND_ID,
			title: localize('polvoOpenCodeMode', "Abrir modo Code"),
			f1: false,
		});
	}
	run(accessor: ServicesAccessor): Promise<void> {
		return accessor.get(IPolvoModeNavigationService).navigateTo(PolvoWorkbenchMode.Code);
	}
});
