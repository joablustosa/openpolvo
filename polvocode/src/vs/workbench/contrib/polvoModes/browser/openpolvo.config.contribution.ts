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
	OPENPOLVO_DEFAULT_LOCAL_MODEL,
	OPENPOLVO_DEFAULT_OLLAMA_URL,
	OpenPolvoAgentEnabledSettingId,
	OpenPolvoApiBaseUrlSettingId,
	OpenPolvoApiTokenSettingId,
	OpenPolvoDevWorkflowEnabledSettingId,
	OpenPolvoLocalLlmAutoSetupSettingId,
	OpenPolvoLocalLlmModelSettingId,
	OpenPolvoLocalLlmOllamaUrlSettingId,
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
			description: localize('openpolvo.api.token', "Token Bearer da API OpenPolvo. Preenchido automaticamente no arranque local."),
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
		[OpenPolvoLocalLlmAutoSetupSettingId]: {
			type: 'boolean',
			default: true,
			description: localize('openpolvo.localLlm.autoSetup', "Monitoriza o Ollama em cada arranque e enquanto a app está aberta; oferece instalar ou iniciar automaticamente quando necessário."),
		},
		[OpenPolvoLocalLlmModelSettingId]: {
			type: 'string',
			default: OPENPOLVO_DEFAULT_LOCAL_MODEL,
			description: localize('openpolvo.localLlm.model', "Modelo Ollama usado como LLM local padrão do agente (ex.: llama3.2)."),
		},
		[OpenPolvoLocalLlmOllamaUrlSettingId]: {
			type: 'string',
			default: OPENPOLVO_DEFAULT_OLLAMA_URL,
			description: localize('openpolvo.localLlm.ollamaUrl', "URL do servidor Ollama local."),
		},
	},
});

configurationRegistry.registerDefaultConfigurations([{
	overrides: {
		[AgentHostEnabledSettingId]: true,
		[ChatConfiguration.EditorDefaultProvider]: 'openpolvoAh',
		[ChatConfiguration.EditorLocalAgentEnabled]: false,
		[ChatConfiguration.TitleBarSignInEnabled]: false,
		[ChatConfiguration.AIDisabled]: false,
		[OpenPolvoAgentEnabledSettingId]: true,
		[OpenPolvoApiBaseUrlSettingId]: OFFICIAL_API_DEFAULT_BASE_URL,
	},
}]);
