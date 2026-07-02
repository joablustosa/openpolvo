/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAgentHostService } from '../../../../platform/agentHost/common/agentService.js';
import {
	isOpenPolvoAuthEnabled,
	OpenPolvoApiBaseUrlSettingId,
	OpenPolvoApiTokenSettingId,
	resolveOpenPolvoProtectedResource,
} from '../../../../platform/agentHost/common/openpolvoConfiguration.js';
import { OFFICIAL_API_DEFAULT_BASE_URL } from '../../../../platform/agentHost/common/openpolvoBackendProtocol.js';
import type { AgentInfo } from '../../../../platform/agentHost/common/state/sessionState.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import type { ProtectedResourceMetadata } from '../../../../platform/agentHost/common/state/protocol/state.js';
import type { AgentHostAuthTokenCache } from '../../chat/browser/agentSessions/agentHost/agentHostAuth.js';

export function readOpenPolvoApiToken(configurationService: IConfigurationService): string | undefined {
	const token = configurationService.getValue<string>(OpenPolvoApiTokenSettingId);
	const trimmed = token?.trim();
	return trimmed ? trimmed : undefined;
}

export function readOpenPolvoApiBaseUrl(configurationService: IConfigurationService): string {
	return configurationService.getValue<string>(OpenPolvoApiBaseUrlSettingId) || OFFICIAL_API_DEFAULT_BASE_URL;
}

/**
 * Propaga o JWT da setting `openpolvo.api.token` para o OpenPolvoAgent no
 * processo Agent Host (Node). Sem isto, o login no renderer não chega ao chat
 * nativo Polvo / dev agent.
 */
export function isOpenPolvoProtectedResourceUrl(
	resourceUrl: string,
	configurationService: IConfigurationService,
): boolean {
	if (!isOpenPolvoAuthEnabled(configurationService)) {
		return false;
	}
	const expected = normalizeProtectedResourceUrl(
		resolveOpenPolvoProtectedResource(readOpenPolvoApiBaseUrl(configurationService)),
	);
	return normalizeProtectedResourceUrl(resourceUrl) === expected;
}

/** Agentes cujos recursos OpenPolvo são autenticados via JWT local (não GitHub OAuth). */
export function filterAgentsForOAuthAuthentication(
	agents: readonly AgentInfo[],
	configurationService: IConfigurationService,
): AgentInfo[] {
	return agents
		.map(agent => ({
			...agent,
			protectedResources: (agent.protectedResources ?? []).filter(
				r => !isOpenPolvoProtectedResourceUrl(r.resource, configurationService),
			),
		}))
		.filter(agent => (agent.protectedResources?.length ?? 0) > 0);
}

export async function syncOpenPolvoTokenToAgentHost(
	configurationService: IConfigurationService,
	agentHostService: IAgentHostService,
	logService: ILogService,
	authTokenCache?: AgentHostAuthTokenCache,
): Promise<boolean> {
	const token = readOpenPolvoApiToken(configurationService);
	if (!token) {
		return false;
	}
	const baseUrl = readOpenPolvoApiBaseUrl(configurationService);
	const resource = resolveOpenPolvoProtectedResource(baseUrl);
	try {
		const result = await agentHostService.authenticate({ resource, token });
		if (result.authenticated) {
			authTokenCache?.updateAndIsChanged(resource, undefined, token);
			logService.info('[OpenPolvo] Agent host token synced');
			return true;
		}
		logService.warn('[OpenPolvo] Agent host authenticate returned unauthenticated');
		return false;
	} catch (err) {
		logService.error(`[OpenPolvo] Failed to sync agent host token: ${err instanceof Error ? err.message : String(err)}`);
		return false;
	}
}

export interface IOpenPolvoInteractiveAuthHandlers {
	isEnabled(): boolean;
	ensureSignedIn(): Promise<boolean>;
	refreshSignedIn(): Promise<boolean>;
}

function normalizeProtectedResourceUrl(resource: string): string {
	return resource.replace(/\/$/, '');
}

function requiresOpenPolvoAuth(
	protectedResources: readonly ProtectedResourceMetadata[],
	configurationService: IConfigurationService,
): boolean {
	if (!isOpenPolvoAuthEnabled(configurationService)) {
		return false;
	}
	const expected = normalizeProtectedResourceUrl(
		resolveOpenPolvoProtectedResource(readOpenPolvoApiBaseUrl(configurationService)),
	);
	return protectedResources.some(r => {
		if (r.required === false) {
			return false;
		}
		return normalizeProtectedResourceUrl(r.resource) === expected;
	});
}

/**
 * Autenticação interativa para o recurso protegido OpenPolvo (`/v1/auth/me`).
 * O Agent Host genérico só conhece `IAuthenticationService` (GitHub/etc.); aqui
 * usamos o login OpenPolvo e propagamos o JWT ao processo Node.
 *
 * @returns `undefined` se nenhum recurso OpenPolvo for exigido; senão `true`/`false`.
 */
export async function resolveOpenPolvoAuthenticationInteractively(
	protectedResources: readonly ProtectedResourceMetadata[],
	configurationService: IConfigurationService,
	agentHostService: IAgentHostService,
	logService: ILogService,
	handlers: IOpenPolvoInteractiveAuthHandlers,
	authTokenCache?: AgentHostAuthTokenCache,
): Promise<boolean | undefined> {
	if (!requiresOpenPolvoAuth(protectedResources, configurationService)) {
		return undefined;
	}

	if (readOpenPolvoApiToken(configurationService)) {
		const synced = await syncOpenPolvoTokenToAgentHost(
			configurationService,
			agentHostService,
			logService,
			authTokenCache,
		);
		if (synced) {
			return true;
		}
	}

	if (!handlers.isEnabled()) {
		logService.warn('[OpenPolvo] Auth required but OpenPolvo agent is disabled');
		return false;
	}

	const signedIn = await handlers.ensureSignedIn();
	if (!signedIn) {
		return false;
	}
	return syncOpenPolvoTokenToAgentHost(
		configurationService,
		agentHostService,
		logService,
		authTokenCache,
	);
}
