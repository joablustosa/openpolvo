/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAgentHostService } from '../../../../platform/agentHost/common/agentService.js';
import {
	OpenPolvoApiBaseUrlSettingId,
	OpenPolvoApiTokenSettingId,
	resolveOpenPolvoProtectedResource,
} from '../../../../platform/agentHost/common/openpolvoConfiguration.js';
import { OFFICIAL_API_DEFAULT_BASE_URL } from '../../../../platform/agentHost/common/openpolvoBackendProtocol.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';

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
export async function syncOpenPolvoTokenToAgentHost(
	configurationService: IConfigurationService,
	agentHostService: IAgentHostService,
	logService: ILogService,
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
