/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { env } from '../../../base/common/process.js';
import { OFFICIAL_API_DEFAULT_BASE_URL } from './openpolvoBackendProtocol.js';
import type { ProtectedResourceMetadata } from './state/protocol/state.js';

export const OpenPolvoApiBaseUrlSettingId = 'openpolvo.api.baseUrl';
export const OpenPolvoApiTokenSettingId = 'openpolvo.api.token';
export const OpenPolvoAgentEnabledSettingId = 'openpolvo.agent.enabled';
/** Flags de migração faseada do front antigo (openpolvo) para o polvocode. */
export const OpenPolvoWorkflowsBackendSettingId = 'openpolvo.workflows.useBackend';
export const OpenPolvoDevWorkflowEnabledSettingId = 'openpolvo.devWorkflow.enabled';

/**
 * LLM local (Ollama). Permite que o Open Polvo funcione gratuitamente, sem chaves
 * cloud: no primeiro arranque o app oferece instalar o Ollama e o modelo padrão.
 */
export const OpenPolvoLocalLlmAutoSetupSettingId = 'openpolvo.localLlm.autoSetup';
export const OpenPolvoLocalLlmModelSettingId = 'openpolvo.localLlm.model';
export const OpenPolvoLocalLlmOllamaUrlSettingId = 'openpolvo.localLlm.ollamaUrl';

export const OPENPOLVO_DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
export const OPENPOLVO_DEFAULT_LOCAL_MODEL = 'llama3.2';

export const OpenPolvoApiBaseUrlEnvVar = 'OPENPOLVO_API_BASE_URL';
export const OpenPolvoApiTokenEnvVar = 'OPENPOLVO_API_TOKEN';
export const OpenPolvoAgentEnabledEnvVar = 'OPENPOLVO_AGENT_ENABLED';
export const OpenPolvoDevWorkflowEnabledEnvVar = 'OPENPOLVO_DEV_WORKFLOW_ENABLED';
export const OpenPolvoLocalEmailEnvVar = 'OPENPOLVO_LOCAL_EMAIL';
export const OpenPolvoLocalPasswordEnvVar = 'OPENPOLVO_LOCAL_PASSWORD';

/** Credenciais do admin bootstrap do backend local (openpolvobackend `.env`). */
export const OPENPOLVO_LOCAL_DEFAULT_EMAIL = 'admin@openlaele.local';
export const OPENPOLVO_LOCAL_DEFAULT_PASSWORD = 'ChangeMeLocalDev_Only';

export const OPENPOLVO_AGENT_HOST_SESSION_TYPE = 'agent-host-openpolvo';
export const OPENPOLVO_AGENT_PROVIDER_ID = 'openpolvo';
export const OPENPOLVO_SIGN_IN_COMMAND_ID = 'workbench.action.openpolvo.signIn';

export interface IOpenPolvoStarterSettings {
	readonly baseUrl?: string;
	readonly token?: string;
	readonly enabled?: boolean;
	readonly devWorkflowEnabled?: boolean;
}

export function buildOpenPolvoEnv(
	settings: IOpenPolvoStarterSettings,
	inheritedEnv: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
	const out: Record<string, string> = {};
	const setIfMissing = (key: string, value: string | undefined): void => {
		if (value === undefined || value === '' || inheritedEnv[key] !== undefined) {
			return;
		}
		out[key] = value;
	};
	if (settings.enabled !== undefined) {
		setIfMissing(OpenPolvoAgentEnabledEnvVar, settings.enabled ? 'true' : 'false');
	}
	if (settings.devWorkflowEnabled !== undefined) {
		setIfMissing(OpenPolvoDevWorkflowEnabledEnvVar, settings.devWorkflowEnabled ? 'true' : 'false');
	}
	setIfMissing(OpenPolvoApiBaseUrlEnvVar, settings.baseUrl);
	setIfMissing(OpenPolvoApiTokenEnvVar, settings.token);
	const { email, password } = resolveOpenPolvoLocalCredentials();
	setIfMissing(OpenPolvoLocalEmailEnvVar, email);
	setIfMissing(OpenPolvoLocalPasswordEnvVar, password);
	return out;
}

export function isOpenPolvoAgentEnabledFromEnv(): boolean {
	return env[OpenPolvoAgentEnabledEnvVar] !== 'false';
}

export function isOpenPolvoDevWorkflowEnabledFromEnv(): boolean {
	return env[OpenPolvoDevWorkflowEnabledEnvVar] !== 'false';
}

export function getOpenPolvoApiBaseUrlFromEnv(): string {
	return env[OpenPolvoApiBaseUrlEnvVar] ?? OFFICIAL_API_DEFAULT_BASE_URL;
}

export function isOpenPolvoAuthEnabled(configurationService: { getValue<T>(key: string): T }): boolean {
	return configurationService.getValue<boolean>(OpenPolvoAgentEnabledSettingId) !== false;
}

export function getOpenPolvoApiTokenFromEnv(): string | undefined {
	const token = env[OpenPolvoApiTokenEnvVar];
	return token && token.length > 0 ? token : undefined;
}

/** Credenciais do utilizador admin local (desk MVP totalmente offline). */
export function resolveOpenPolvoLocalCredentials(): { email: string; password: string } {
	const email = env[OpenPolvoLocalEmailEnvVar]?.trim() || OPENPOLVO_LOCAL_DEFAULT_EMAIL;
	const password = env[OpenPolvoLocalPasswordEnvVar]?.trim() || OPENPOLVO_LOCAL_DEFAULT_PASSWORD;
	return { email, password };
}

/** Base URL normalizada (sem barra final). */
export function resolveOpenPolvoApiBaseUrl(baseUrl?: string): string {
	const raw = baseUrl ?? getOpenPolvoApiBaseUrlFromEnv() ?? OFFICIAL_API_DEFAULT_BASE_URL;
	return raw.replace(/\/$/, '');
}

/** Identificador RFC 9728 usado pelo fluxo `authenticate` do Agent Host. */
export function resolveOpenPolvoProtectedResource(baseUrl?: string): string {
	return `${resolveOpenPolvoApiBaseUrl(baseUrl)}/v1/auth/me`;
}

export function buildOpenPolvoProtectedResourceMetadata(baseUrl?: string): ProtectedResourceMetadata {
	const resource = resolveOpenPolvoProtectedResource(baseUrl);
	return {
		resource,
		resource_name: 'OpenPolvo API',
		authorization_servers: [],
		required: true,
	};
}
