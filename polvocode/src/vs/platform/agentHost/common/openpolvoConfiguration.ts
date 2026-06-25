/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OFFICIAL_API_DEFAULT_BASE_URL } from './openpolvoBackendProtocol.js';
import type { ProtectedResourceMetadata } from './state/protocol/state.js';

export const OpenPolvoApiBaseUrlSettingId = 'openpolvo.api.baseUrl';
export const OpenPolvoApiTokenSettingId = 'openpolvo.api.token';
export const OpenPolvoAgentEnabledSettingId = 'openpolvo.agent.enabled';
/** Flags de migração faseada do front antigo (openpolvo) para o polvocode. */
export const OpenPolvoWorkflowsBackendSettingId = 'openpolvo.workflows.useBackend';
export const OpenPolvoDevWorkflowEnabledSettingId = 'openpolvo.devWorkflow.enabled';

export const OpenPolvoApiBaseUrlEnvVar = 'OPENPOLVO_API_BASE_URL';
export const OpenPolvoApiTokenEnvVar = 'OPENPOLVO_API_TOKEN';
export const OpenPolvoAgentEnabledEnvVar = 'OPENPOLVO_AGENT_ENABLED';

export const OPENPOLVO_AGENT_HOST_SESSION_TYPE = 'agent-host-openpolvo';
export const OPENPOLVO_AGENT_PROVIDER_ID = 'openpolvo';
export const OPENPOLVO_SIGN_IN_COMMAND_ID = 'workbench.action.openpolvo.signIn';

export interface IOpenPolvoStarterSettings {
	readonly baseUrl?: string;
	readonly token?: string;
	readonly enabled?: boolean;
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
	setIfMissing(OpenPolvoApiBaseUrlEnvVar, settings.baseUrl);
	setIfMissing(OpenPolvoApiTokenEnvVar, settings.token);
	return out;
}

export function isOpenPolvoAgentEnabledFromEnv(): boolean {
	return process.env[OpenPolvoAgentEnabledEnvVar] !== 'false';
}

export function getOpenPolvoApiBaseUrlFromEnv(): string {
	return process.env[OpenPolvoApiBaseUrlEnvVar] ?? OFFICIAL_API_DEFAULT_BASE_URL;
}

export function isOpenPolvoAuthEnabled(configurationService: { getValue<T>(key: string): T }): boolean {
	return configurationService.getValue<boolean>(OpenPolvoAgentEnabledSettingId) !== false;
}

export function getOpenPolvoApiTokenFromEnv(): string | undefined {
	const token = process.env[OpenPolvoApiTokenEnvVar];
	return token && token.length > 0 ? token : undefined;
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
