/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { isOpenPolvoAuthEnabled as isOpenPolvoAuthEnabledFromConfig } from '../../../../platform/agentHost/common/openpolvoConfiguration.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IAgentHostService } from '../../../../platform/agentHost/common/agentService.js';
import { IOpenPolvoWorkbenchApiService } from './openPolvoWorkbenchApiService.js';
import { OpenPolvoSignInPage } from './openPolvoSignInPage.js';
import { OpenPolvoApiTokenSettingId } from '../common/openpolvoConfiguration.js';
import { syncOpenPolvoTokenToAgentHost } from './openPolvoAgentHostAuth.js';

export const IOpenPolvoSignInService = createDecorator<IOpenPolvoSignInService>('openPolvoSignInService');

export interface IOpenPolvoSignInService {
	readonly _serviceBrand: undefined;
	isEnabled(): boolean;
	isSignedIn(): boolean;
	signIn(): Promise<boolean>;
}

export function isOpenPolvoAuthEnabled(configurationService: IConfigurationService): boolean {
	return isOpenPolvoAuthEnabledFromConfig(configurationService);
}

export class OpenPolvoSignInService implements IOpenPolvoSignInService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILayoutService private readonly layoutService: ILayoutService,
		@ILogService private readonly logService: ILogService,
		@IOpenPolvoWorkbenchApiService private readonly apiService: IOpenPolvoWorkbenchApiService,
		@IAgentHostService private readonly agentHostService: IAgentHostService,
	) { }

	isEnabled(): boolean {
		return isOpenPolvoAuthEnabled(this.configurationService);
	}

	isSignedIn(): boolean {
		const token = this.configurationService.getValue<string>(OpenPolvoApiTokenSettingId);
		return !!token?.trim();
	}

	async signIn(): Promise<boolean> {
		const page = new OpenPolvoSignInPage(this.layoutService.activeContainer);

		while (true) {
			const credentials = await page.waitForSubmit();
			if (!credentials) {
				return false;
			}

			page.setBusy(true);

			try {
				if (credentials.mode === 'register') {
					await this.apiService.register(credentials.email, credentials.password, credentials.name);
					this.logService.info('[OpenPolvo] Registration and sign-in completed successfully');
				} else {
					await this.apiService.login(credentials.email, credentials.password);
					this.logService.info('[OpenPolvo] Sign-in completed successfully');
				}
				await syncOpenPolvoTokenToAgentHost(this.configurationService, this.agentHostService, this.logService);
				page.close();
				return true;
			} catch (err) {
				this.logService.error(`[OpenPolvo] Auth failed: ${err instanceof Error ? err.message : String(err)}`);
				page.setBusy(false);
				const message = err instanceof Error && err.message.includes('registered')
					? localize('openpolvo.emailTaken', "This email is already registered.")
					: localize('openpolvo.signInFailedDetail', "Could not sign in. Check your email and password and try again.");
				page.showError(message);
			}
		}
	}
}

registerSingleton(IOpenPolvoSignInService, OpenPolvoSignInService, InstantiationType.Delayed);
