/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { observableValue } from '../../../../base/common/observable.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { ILogService } from '../../../log/common/log.js';
import {
	AgentProvider,
	AgentSession,
	AgentSignal,
	IAgent,
	IAgentCreateSessionConfig,
	IAgentCreateSessionResult,
	IAgentDescriptor,
	IAgentModelInfo,
	IAgentResolveSessionConfigParams,
	IAgentSessionConfigCompletionsParams,
	IAgentSessionMetadata,
} from '../../common/agentService.js';
import { OPENPOLVO_AGENT_PROVIDER_ID, buildOpenPolvoProtectedResourceMetadata, getOpenPolvoApiBaseUrlFromEnv } from '../../common/openpolvoConfiguration.js';
import { buildDeskContext, toToolCall } from '../../common/openpolvoBackendProtocol.js';
import type { ProtectedResourceMetadata } from '../../common/state/protocol/state.js';
import type { ResolveSessionConfigResult, SessionConfigCompletionsResult } from '../../common/state/protocol/commands.js';
import { ActionType, type ChatAction, type SessionAction } from '../../common/state/sessionActions.js';
import { ResponsePartKind, type AgentSelection, type MessageAttachment, type ModelSelection, type PendingMessage } from '../../common/state/sessionState.js';
import type { ClientPluginCustomization, Customization } from '../../common/state/protocol/state.js';
import type { ISyncedCustomization } from '../../common/agentPluginManager.js';
import { OpenPolvoApiClient } from './openPolvoApiClient.js';
import { buildOpenPolvoRequestContext, type IOpenPolvoRequestContext } from './openPolvoContext.js';
import { runDeskTool } from './deskToolRunner.js';

interface IOpenPolvoSessionState {
	readonly session: URI;
	apiSessionId: string;
	modelId?: string;
	workingDirectory?: string;
	abortController?: AbortController;
}

export class OpenPolvoAgent extends Disposable implements IAgent {
	readonly id: AgentProvider = OPENPOLVO_AGENT_PROVIDER_ID;

	private readonly _onDidSessionProgress = this._register(new Emitter<AgentSignal>());
	readonly onDidSessionProgress = this._onDidSessionProgress.event;

	private readonly _models = observableValue<readonly IAgentModelInfo[]>(this, []);
	readonly models = this._models;

	private readonly _api = new OpenPolvoApiClient();
	private readonly _sessions = new Map<string, IOpenPolvoSessionState>();

	constructor(
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		void this._refreshModels();
	}

	getDescriptor(): IAgentDescriptor {
		return {
			provider: this.id,
			displayName: 'Polvo',
			description: localize('openPolvoAgent.description', "Agente OpenPolvo conectado à sua API."),
		};
	}

	getProtectedResources(): ProtectedResourceMetadata[] {
		return [buildOpenPolvoProtectedResourceMetadata(getOpenPolvoApiBaseUrlFromEnv())];
	}

	async listSessions(): Promise<IAgentSessionMetadata[]> {
		return [...this._sessions.values()].map(s => ({
			session: s.session,
			startTime: Date.now(),
			modifiedTime: Date.now(),
		}));
	}

	async getSessionMetadata(session: URI): Promise<IAgentSessionMetadata | undefined> {
		const state = this._sessions.get(AgentSession.id(session));
		if (!state) {
			return undefined;
		}
		return { session, startTime: Date.now(), modifiedTime: Date.now() };
	}

	async createSession(config?: IAgentCreateSessionConfig): Promise<IAgentCreateSessionResult> {
		const session = config?.session ?? AgentSession.uri(this.id, generateUuid());
		const modelId = config?.model?.id ?? 'polvo';
		const apiSession = await this._api.createSession(undefined, modelId);
		const workingDirectory = config?.workingDirectory?.fsPath ?? process.cwd();
		this._sessions.set(AgentSession.id(session), {
			session,
			apiSessionId: apiSession.id,
			modelId,
			workingDirectory,
		});
		return {
			session,
			workingDirectory: config?.workingDirectory,
		};
	}

	async resolveSessionConfig(_params: IAgentResolveSessionConfigParams): Promise<ResolveSessionConfigResult> {
		return { schema: { type: 'object', properties: {} }, values: {} };
	}

	async sessionConfigCompletions(_params: IAgentSessionConfigCompletionsParams): Promise<SessionConfigCompletionsResult> {
		return { items: [] };
	}

	async sendMessage(session: URI, prompt: string, attachments?: readonly MessageAttachment[], turnId?: string, _chat?: URI): Promise<void> {
		const state = this._sessions.get(AgentSession.id(session));
		if (!state) {
			throw new Error(`OpenPolvo session not found: ${session.toString()}`);
		}
		const effectiveTurnId = turnId ?? generateUuid();
		state.abortController?.abort();
		state.abortController = new AbortController();

		const requestContext = buildOpenPolvoRequestContext(attachments, state.workingDirectory);
		const promptWithContext = appendSelectionContext(prompt, requestContext);
		const deskContext = buildDeskContext(state.apiSessionId, state.workingDirectory, 'agent', state.modelId);
		let markdownPartId: string | undefined;
		const pendingTools: Promise<void>[] = [];

		try {
			await this._api.streamMessage(
				state.apiSessionId,
				promptWithContext,
				{
					modelId: state.modelId,
					deskContext,
				},
				event => {
					switch (event.type) {
						case 'thinking':
							if (event.content) {
								this._fire(session, {
									type: ActionType.ChatResponsePart,
									turnId: effectiveTurnId,
									part: {
										kind: ResponsePartKind.Reasoning,
										id: generateUuid(),
										content: event.content,
									},
								});
							}
							break;
						case 'text_delta':
							if (!event.delta) {
								break;
							}
							if (!markdownPartId) {
								markdownPartId = generateUuid();
								this._fire(session, {
									type: ActionType.ChatResponsePart,
									turnId: effectiveTurnId,
									part: { kind: ResponsePartKind.Markdown, id: markdownPartId, content: event.delta },
								});
							} else {
								this._fire(session, {
									type: ActionType.ChatDelta,
									turnId: effectiveTurnId,
									partId: markdownPartId,
									content: event.delta,
								});
							}
							break;
						case 'agent_event':
							this._surfaceAgentEvent(session, effectiveTurnId, event.agentEventType, event.payload);
							break;
						case 'tool_call':
							pendingTools.push(this._handleToolCall(state, event.payload));
							break;
						case 'file':
							pendingTools.push(this._applyFile(state, event.file));
							break;
						case 'error':
							this._fire(session, {
								type: ActionType.ChatError,
								turnId: effectiveTurnId,
								error: { errorType: 'OpenPolvoError', message: event.error ?? 'Unknown error' },
							});
							break;
						case 'done':
							this._fire(session, { type: ActionType.ChatTurnComplete, turnId: effectiveTurnId });
							return;
					}
				},
				state.abortController.signal,
			);
			await Promise.allSettled(pendingTools);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this._logService.error(`[OpenPolvo] sendMessage failed: ${message}`);
			this._fire(session, {
				type: ActionType.ChatError,
				turnId: effectiveTurnId,
				error: { errorType: 'OpenPolvoError', message },
			});
			this._fire(session, { type: ActionType.ChatTurnComplete, turnId: effectiveTurnId });
		}
	}

	setPendingMessages(_session: URI, _steeringMessage: PendingMessage | undefined, _queuedMessages: readonly PendingMessage[]): void { }

	async getSessionMessages(_session: URI): Promise<readonly never[]> {
		return [];
	}

	async disposeSession(session: URI): Promise<void> {
		this._sessions.delete(AgentSession.id(session));
	}

	async abortSession(session: URI): Promise<void> {
		const state = this._sessions.get(AgentSession.id(session));
		state?.abortController?.abort();
	}

	respondToPermissionRequest(): void { }
	respondToUserInputRequest(): void { }

	async changeModel(session: URI, model: ModelSelection): Promise<void> {
		const state = this._sessions.get(AgentSession.id(session));
		if (state) {
			state.modelId = model.id;
		}
	}

	async changeAgent(_session: URI, _agent: AgentSelection | undefined): Promise<void> { }

	async authenticate(_resource: string, token: string): Promise<boolean> {
		this._api.setToken(token);
		void this._refreshModels();
		return true;
	}

	getCustomizations(): Customization[] {
		return [];
	}

	async setClientCustomizations(_session: URI, _clientId: string, _customizations: ClientPluginCustomization[]): Promise<ISyncedCustomization[]> {
		return [];
	}

	setCustomizationEnabled(): void { }
	setClientTools(): void { }
	onClientToolCallComplete(): void { }
	async shutdown(): Promise<void> { }

	private _fire(session: URI, action: SessionAction | ChatAction): void {
		this._onDidSessionProgress.fire({ kind: 'action', session, action });
	}

	/** Mostra eventos do grafo (tool_call/tool_result/observation) como passos de raciocínio. */
	private _surfaceAgentEvent(session: URI, turnId: string, eventType: string | undefined, payload: Record<string, unknown> | undefined): void {
		if (!eventType || eventType === 'thought' || eventType === 'final') {
			return;
		}
		const tool = payload && typeof payload.tool === 'string' ? payload.tool : undefined;
		const label = tool ? `${eventType}: ${tool}` : eventType;
		this._fire(session, {
			type: ActionType.ChatResponsePart,
			turnId,
			part: { kind: ResponsePartKind.Reasoning, id: generateUuid(), content: label },
		});
	}

	/** Executa uma tool local pedida pelo backend e devolve o resultado pela bridge. */
	private async _handleToolCall(state: IOpenPolvoSessionState, payload: Record<string, unknown> | undefined): Promise<void> {
		const call = toToolCall(payload);
		if (!call) {
			return;
		}
		try {
			const result = await runDeskTool(call, state.workingDirectory);
			await this._api.submitDeskToolResult(state.apiSessionId, call.id, result, state.workingDirectory);
		} catch (err) {
			this._logService.error(`[OpenPolvo] tool call failed (${call.tool}): ${err instanceof Error ? err.message : String(err)}`);
			try {
				await this._api.submitDeskToolResult(state.apiSessionId, call.id, {
					ok: false,
					error: err instanceof Error ? err.message : String(err),
				}, state.workingDirectory);
			} catch {
				// best-effort
			}
		}
	}

	/** Aplica um ficheiro emitido pelo dev workflow no workspace local. */
	private async _applyFile(state: IOpenPolvoSessionState, file: { path: string; content: string } | undefined): Promise<void> {
		if (!file?.path || !state.workingDirectory) {
			return;
		}
		try {
			await runDeskTool(
				{ id: 'file-apply', tool: 'filesystem_write', args: { rel_path: file.path, content: file.content }, requiresClient: true },
				state.workingDirectory,
			);
		} catch (err) {
			this._logService.warn(`[OpenPolvo] failed to apply file ${file.path}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private async _refreshModels(): Promise<void> {
		try {
			const models = await this._api.listModels();
			this._models.set(models.map(m => ({
				provider: this.id,
				id: m.id,
				name: m.name,
				maxContextWindow: 128000,
				supportsVision: false,
				_meta: { description: m.description, configured: m.configured, llmProvider: m.provider },
			})), undefined);
		} catch (err) {
			this._logService.warn(`[OpenPolvo] Failed to load models: ${err instanceof Error ? err.message : String(err)}`);
			this._models.set([{
				provider: this.id,
				id: 'auto',
				name: 'Automático',
				maxContextWindow: 128000,
				supportsVision: false,
			}], undefined);
		}
	}
}

/**
 * Anexa contexto de seleção/ficheiros ao prompt, já que o contrato oficial só transporta
 * `desk_context` (workspace). Mantém o agente ciente do código aberto/selecionado.
 */
function appendSelectionContext(prompt: string, context: IOpenPolvoRequestContext): string {
	const parts: string[] = [];
	if (context.selection?.text) {
		const file = context.selection.file ?? context.selection.path ?? '';
		const header = file ? `Seleção (${file}):` : 'Seleção:';
		parts.push(`${header}\n\`\`\`\n${context.selection.text}\n\`\`\``);
	}
	if (context.open_files && context.open_files.length > 0) {
		parts.push(`Ficheiros abertos: ${context.open_files.join(', ')}`);
	}
	if (parts.length === 0) {
		return prompt;
	}
	return `${prompt}\n\n---\n${parts.join('\n\n')}`;
}
