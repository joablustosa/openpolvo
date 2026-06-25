/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { AgentHostEnabledSettingId } from '../../../../platform/agentHost/common/agentService.js';
import { ChatConfiguration } from '../../chat/common/constants.js';
import {
	OpenPolvoAgentEnabledSettingId,
	OpenPolvoApiBaseUrlSettingId,
	OpenPolvoApiTokenSettingId,
	OpenPolvoDevWorkflowEnabledSettingId,
	OpenPolvoWorkflowsBackendSettingId,
} from '../common/openpolvoConfiguration.js';
import { OFFICIAL_API_DEFAULT_BASE_URL } from '../../../../platform/agentHost/common/openpolvoBackendProtocol.js';

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

configurationRegistry.registerConfiguration({
	id: 'openpolvo',
	title: localize('openpolvoConfigurationTitle', "OpenPolvo"),
	type: 'object',
	properties: {
		[OpenPolvoApiBaseUrlSettingId]: {
			type: 'string',
			default: OFFICIAL_API_DEFAULT_BASE_URL,
			description: localize('openpolvo.api.baseUrl', "URL base da API OpenPolvo (Go, openpolvobackend)."),
		},
		[OpenPolvoApiTokenSettingId]: {
			type: 'string',
			default: '',
			description: localize('openpolvo.api.token', "Token Bearer da API OpenPolvo. Preenchido automaticamente após o login."),
		},
		[OpenPolvoAgentEnabledSettingId]: {
			type: 'boolean',
			default: true,
			description: localize('openpolvo.agent.enabled', "Habilita o agente OpenPolvo no Agent Host."),
		},
		[OpenPolvoWorkflowsBackendSettingId]: {
			type: 'boolean',
			default: true,
			description: localize('openpolvo.workflows.useBackend', "Gera automações via /v1/workflows/generate do backend oficial (em vez do chat local)."),
		},
		[OpenPolvoDevWorkflowEnabledSettingId]: {
			type: 'boolean',
			default: true,
			description: localize('openpolvo.devWorkflow.enabled', "Aplica ficheiros gerados pelo agente de desenvolvimento no workspace local."),
		},
	},
});

configurationRegistry.registerDefaultConfigurations([{
	overrides: {
		[AgentHostEnabledSettingId]: true,
		[ChatConfiguration.EditorDefaultProvider]: 'openpolvoAh',
		[ChatConfiguration.EditorLocalAgentEnabled]: false,
		[OpenPolvoAgentEnabledSettingId]: true,
		[OpenPolvoApiBaseUrlSettingId]: OFFICIAL_API_DEFAULT_BASE_URL,
	},
}]);
