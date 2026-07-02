/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import {
	isOpenPolvoAuthEnabled,
	OpenPolvoApiTokenSettingId,
	resolveOpenPolvoLocalCredentials,
} from '../../../../platform/agentHost/common/openpolvoConfiguration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IDefaultAccountService } from '../../../../platform/defaultAccount/common/defaultAccount.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IChatEntitlementService } from '../../../services/chat/common/chatEntitlementService.js';
import type { IResolvedAccountInfo } from '../../../sessions/browser/accountTitleBarState.js';

/** Mesmo id que `defaultAccount.ts` — Agents title bar / menu Sign In. */
const DEFAULT_ACCOUNT_STATUS_KEY = new RawContextKey<string>('defaultAccountStatus', 'uninitialized');

export function readOpenPolvoSignedIn(configurationService: IConfigurationService): boolean {
	if (!isOpenPolvoAuthEnabled(configurationService)) {
		return false;
	}
	const token = configurationService.getValue<string>(OpenPolvoApiTokenSettingId);
	return !!token?.trim();
}

export function resolveOpenPolvoAccountInfo(configurationService: IConfigurationService): IResolvedAccountInfo | undefined {
	if (!readOpenPolvoSignedIn(configurationService)) {
		return undefined;
	}
	const { email } = resolveOpenPolvoLocalCredentials();
	return {
		accountName: email,
		accountProviderId: 'openpolvo',
		accountProviderLabel: 'OpenPolvo',
	};
}

/**
 * Após login JWT local: marca entitlement/setup e estado de conta para a UI Agents.
 */
export function applyOpenPolvoDeskSession(
	configurationService: IConfigurationService,
	chatEntitlementService: IChatEntitlementService,
	accountStatusKey: IContextKey<string> | undefined,
	logService: ILogService,
): void {
	if (!readOpenPolvoSignedIn(configurationService)) {
		return;
	}
	chatEntitlementService.markOpenPolvoDeskReady();
	accountStatusKey?.set('available');
	logService.info('[OpenPolvo] Sessão desk local aplicada (sem GitHub)');
}

/**
 * Mantém `defaultAccountStatus=available` quando há JWT OpenPolvo, mesmo que o
 * DefaultAccountService (GitHub) reporte indisponível.
 */
export class OpenPolvoDeskSessionContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.openPolvoDeskSession';

	private readonly accountStatusKey: IContextKey<string>;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IChatEntitlementService private readonly chatEntitlementService: IChatEntitlementService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IDefaultAccountService private readonly defaultAccountService: IDefaultAccountService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.accountStatusKey = DEFAULT_ACCOUNT_STATUS_KEY.bindTo(contextKeyService);

		if (!isOpenPolvoAuthEnabled(this.configurationService)) {
			return;
		}

		const sync = () => this.syncDeskSession();
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(OpenPolvoApiTokenSettingId)) {
				sync();
			}
		}));
		this._register(this.defaultAccountService.onDidChangeDefaultAccount(() => sync()));
		sync();
	}

	private syncDeskSession(): void {
		if (!readOpenPolvoSignedIn(this.configurationService)) {
			return;
		}
		applyOpenPolvoDeskSession(
			this.configurationService,
			this.chatEntitlementService,
			this.accountStatusKey,
			this.logService,
		);
	}
}

registerWorkbenchContribution2(OpenPolvoDeskSessionContribution.ID, OpenPolvoDeskSessionContribution, WorkbenchPhase.BlockRestore);
