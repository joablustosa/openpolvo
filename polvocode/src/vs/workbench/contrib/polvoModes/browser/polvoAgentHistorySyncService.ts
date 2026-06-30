/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IOpenPolvoWorkbenchApiService } from './openPolvoWorkbenchApiService.js';
import { IOpenPolvoSignInService } from './openPolvoAuth.js';
import { IPolvoAgentConversationsService } from './polvoAgentConversationsService.js';
import { withOpenPolvoApiAuth } from './openPolvoApiAuthHelper.js';

export const IPolvoAgentHistorySyncService = createDecorator<IPolvoAgentHistorySyncService>('polvoAgentHistorySyncService');

export interface IPolvoAgentHistorySyncService {
	readonly _serviceBrand: undefined;
	syncOnStartup(): Promise<void>;
	syncConversationMessages(conversationId: string): Promise<void>;
}

export class PolvoAgentHistorySyncService extends Disposable implements IPolvoAgentHistorySyncService {
	declare readonly _serviceBrand: undefined;

	private _syncInFlight: Promise<void> | undefined;

	constructor(
		@IPolvoAgentConversationsService private readonly conversationsService: IPolvoAgentConversationsService,
		@IOpenPolvoWorkbenchApiService private readonly openPolvoApi: IOpenPolvoWorkbenchApiService,
		@IOpenPolvoSignInService private readonly signInService: IOpenPolvoSignInService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async syncOnStartup(): Promise<void> {
		if (this._syncInFlight) {
			return this._syncInFlight;
		}
		this._syncInFlight = this.doSyncOnStartup().finally(() => {
			this._syncInFlight = undefined;
		});
		return this._syncInFlight;
	}

	private async doSyncOnStartup(): Promise<void> {
		const signedIn = await this.signInService.ensureSignedIn();
		if (!signedIn) {
			return;
		}
		try {
			await withOpenPolvoApiAuth(this.signInService, async () => {
				const serverConversations = await this.openPolvoApi.listConversations();
				const serverIds = new Set(serverConversations.map(c => c.id));
				for (const server of serverConversations) {
					const local = this.conversationsService.conversations.find(c => c.apiSessionId === server.id);
					if (local && local.messages.length > 0) {
						this.conversationsService.upsertFromServer(server, []);
						continue;
					}
					const messages = await this.openPolvoApi.getMessages(server.id);
					this.conversationsService.upsertFromServer(server, messages);
				}
				for (const local of this.conversationsService.conversations) {
					if (local.apiSessionId && !serverIds.has(local.apiSessionId)) {
						this.logService.warn(`[OpenPolvo] Conversa local órfã (apiSessionId=${local.apiSessionId})`);
					}
				}
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.logService.warn(`[OpenPolvo] Falha ao sincronizar histórico: ${message}`);
		}
	}

	async syncConversationMessages(conversationId: string): Promise<void> {
		const conversation = this.conversationsService.getConversation(conversationId);
		if (!conversation?.apiSessionId) {
			return;
		}
		const signedIn = await this.signInService.ensureSignedIn();
		if (!signedIn) {
			return;
		}
		try {
			await withOpenPolvoApiAuth(this.signInService, async () => {
				const [messages, memory] = await Promise.all([
					this.openPolvoApi.getMessages(conversation.apiSessionId!),
					this.openPolvoApi.getAgentMemory(conversation.apiSessionId!).catch(() => undefined),
				]);
				this.conversationsService.upsertFromServer(
					{
						id: conversation.apiSessionId!,
						title: conversation.title,
						default_model_provider: conversation.modelId,
						updated_at: conversation.updatedAt,
					},
					messages,
				);
				if (memory && (memory.global || memory.builder)) {
					this.conversationsService.setSystemContext(conversationId, {
						global: memory.global,
						builder: memory.builder,
					});
				}
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.logService.warn(`[OpenPolvo] Falha ao carregar mensagens: ${message}`);
		}
	}
}

registerSingleton(IPolvoAgentHistorySyncService, PolvoAgentHistorySyncService, InstantiationType.Delayed);

export class PolvoAgentHistorySyncContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.polvoAgentHistorySync';

	constructor(
		@IPolvoAgentHistorySyncService private readonly historySyncService: IPolvoAgentHistorySyncService,
	) {
		super();
		void this.historySyncService.syncOnStartup();
	}
}

registerWorkbenchContribution2(PolvoAgentHistorySyncContribution.ID, PolvoAgentHistorySyncContribution, WorkbenchPhase.AfterRestored);
