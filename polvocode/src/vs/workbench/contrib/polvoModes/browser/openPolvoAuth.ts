/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../../base/common/async.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import {
	isOpenPolvoAuthEnabled as isOpenPolvoAuthEnabledFromConfig,
	resolveOpenPolvoLocalCredentials,
} from '../../../../platform/agentHost/common/openpolvoConfiguration.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IAgentHostService } from '../../../../platform/agentHost/common/agentService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IOpenPolvoWorkbenchApiService } from './openPolvoWorkbenchApiService.js';
import { OpenPolvoApiTokenSettingId } from '../common/openpolvoConfiguration.js';
import { syncOpenPolvoTokenToAgentHost } from './openPolvoAgentHostAuth.js';

export const IOpenPolvoSignInService = createDecorator<IOpenPolvoSignInService>('openPolvoSignInService');

export interface IOpenPolvoSignInService {
	readonly _serviceBrand: undefined;
	isEnabled(): boolean;
	isSignedIn(): boolean;
	/** Login silencioso com credenciais locais (sem UI). */
	ensureSignedIn(): Promise<boolean>;
	/** Limpa o token e volta a autenticar (ex.: 401). */
	refreshSignedIn(): Promise<boolean>;
	/** @deprecated Usar `ensureSignedIn`. Mantido para compatibilidade com Agent Host. */
	signIn(): Promise<boolean>;
}

export function isOpenPolvoAuthEnabled(configurationService: IConfigurationService): boolean {
	return isOpenPolvoAuthEnabledFromConfig(configurationService);
}

const AUTO_LOGIN_RETRY_MS = 2_000;
const AUTO_LOGIN_MAX_ATTEMPTS = 15;

export class OpenPolvoSignInService extends Disposable implements IOpenPolvoSignInService {
	declare readonly _serviceBrand: undefined;

	private loginInFlight: Promise<boolean> | undefined;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
		@IOpenPolvoWorkbenchApiService private readonly apiService: IOpenPolvoWorkbenchApiService,
		@IAgentHostService private readonly agentHostService: IAgentHostService,
	) {
		super();
	}

	isEnabled(): boolean {
		return isOpenPolvoAuthEnabled(this.configurationService);
	}

	isSignedIn(): boolean {
		const token = this.configurationService.getValue<string>(OpenPolvoApiTokenSettingId);
		return !!token?.trim();
	}

	async ensureSignedIn(): Promise<boolean> {
		if (!this.isEnabled()) {
			return true;
		}
		if (this.isSignedIn()) {
			await syncOpenPolvoTokenToAgentHost(this.configurationService, this.agentHostService, this.logService);
			return true;
		}
		if (this.loginInFlight) {
			return this.loginInFlight;
		}

		this.loginInFlight = this.doSilentLogin().finally(() => {
			this.loginInFlight = undefined;
		});
		return this.loginInFlight;
	}

	async refreshSignedIn(): Promise<boolean> {
		if (!this.isEnabled()) {
			return true;
		}
		await this.configurationService.updateValue(OpenPolvoApiTokenSettingId, '');
		this.loginInFlight = undefined;
		return this.doSilentLogin();
	}

	signIn(): Promise<boolean> {
		return this.ensureSignedIn();
	}

	private async doSilentLogin(): Promise<boolean> {
		const { email, password } = resolveOpenPolvoLocalCredentials();

		for (let attempt = 1; attempt <= AUTO_LOGIN_MAX_ATTEMPTS; attempt++) {
			try {
				await this.apiService.login(email, password);
				await syncOpenPolvoTokenToAgentHost(this.configurationService, this.agentHostService, this.logService);
				this.logService.info('[OpenPolvo] Login local automático concluído');
				return true;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				if (attempt < AUTO_LOGIN_MAX_ATTEMPTS) {
					this.logService.warn(`[OpenPolvo] Login automático tentativa ${attempt}/${AUTO_LOGIN_MAX_ATTEMPTS} falhou: ${message}`);
					await timeout(AUTO_LOGIN_RETRY_MS);
					continue;
				}
				this.logService.error(`[OpenPolvo] Login automático falhou após ${AUTO_LOGIN_MAX_ATTEMPTS} tentativas: ${message}`);
				return false;
			}
		}
		return false;
	}
}

registerSingleton(IOpenPolvoSignInService, OpenPolvoSignInService, InstantiationType.Delayed);

/**
 * No arranque do workbench autentica silenciosamente com o admin local do backend,
 * para que Agente e Workflows funcionem sem ecrã de login.
 */
export class OpenPolvoLocalAutoAuthContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.openPolvoLocalAutoAuth';

	constructor(
		@IOpenPolvoSignInService private readonly signInService: IOpenPolvoSignInService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		void this.signInService.ensureSignedIn().then(ok => {
			if (!ok) {
				this.logService.error('[OpenPolvo] Não foi possível autenticar automaticamente. Verifique se o backend está a correr em openpolvo.api.baseUrl.');
			}
		});
	}
}

registerWorkbenchContribution2(OpenPolvoLocalAutoAuthContribution.ID, OpenPolvoLocalAutoAuthContribution, WorkbenchPhase.AfterRestored);
