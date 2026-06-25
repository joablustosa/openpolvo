/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { AgentHostEnabledSettingId, IAgentHostService } from '../../../../platform/agentHost/common/agentService.js';
import {
	OPENPOLVO_AGENT_PROVIDER_ID,
	OpenPolvoAgentEnabledSettingId,
	OpenPolvoApiBaseUrlSettingId,
	OpenPolvoApiTokenSettingId,
} from '../../../../platform/agentHost/common/openpolvoConfiguration.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { syncOpenPolvoTokenToAgentHost } from './openPolvoAgentHostAuth.js';

/**
 * Mantém o token OpenPolvo do renderer sincronizado com o Agent Host após
 * login, mudança de settings ou restart do processo utility.
 */
export class OpenPolvoAgentHostAuthContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.openPolvoAgentHostAuth';

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IAgentHostService private readonly agentHostService: IAgentHostService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		if (!this.configurationService.getValue<boolean>(AgentHostEnabledSettingId)) {
			return;
		}
		if (this.configurationService.getValue<boolean>(OpenPolvoAgentEnabledSettingId) === false) {
			return;
		}

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(OpenPolvoApiTokenSettingId) || e.affectsConfiguration(OpenPolvoApiBaseUrlSettingId)) {
				void syncOpenPolvoTokenToAgentHost(this.configurationService, this.agentHostService, this.logService);
			}
		}));

		this._register(this.agentHostService.onAgentHostStart(() => {
			void syncOpenPolvoTokenToAgentHost(this.configurationService, this.agentHostService, this.logService);
		}));

		this._register(this.agentHostService.rootState.onDidChange(rootState => {
			if (rootState instanceof Error) {
				return;
			}
			if (rootState.agents.some(a => a.provider === OPENPOLVO_AGENT_PROVIDER_ID)) {
				void syncOpenPolvoTokenToAgentHost(this.configurationService, this.agentHostService, this.logService);
			}
		}));

		void syncOpenPolvoTokenToAgentHost(this.configurationService, this.agentHostService, this.logService);
	}
}
