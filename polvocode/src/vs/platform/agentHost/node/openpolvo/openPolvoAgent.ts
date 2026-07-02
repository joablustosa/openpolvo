/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type { IReference } from '../../../../base/common/lifecycle.js';
import { observableValue } from '../../../../base/common/observable.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../files/common/files.js';
import { IInstantiationService } from '../../../instantiation/common/instantiation.js';
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
import {
	OPENPOLVO_AGENT_PROVIDER_ID,
	buildOpenPolvoProtectedResourceMetadata,
	getOpenPolvoApiBaseUrlFromEnv,
	isOpenPolvoDevWorkflowEnabledFromEnv,
} from '../../common/openpolvoConfiguration.js';
import { toToolCall, type INormalizedStreamEvent } from '../../common/openpolvoBackendProtocol.js';
import {
	normalizeDevRelativePath,
	normalizeProjectRoot,
	prefixDevRelativePath,
	PROJECTS_PARENT_DIR,
	readProjectRootFromMetadata,
	readProjectRootFromProgressPayload,
	slugifyProjectTitle,
} from '../../common/openPolvoDevProject.js';
import type { ProtectedResourceMetadata } from '../../common/state/protocol/state.js';
import type { ResolveSessionConfigResult, SessionConfigCompletionsResult } from '../../common/state/protocol/commands.js';
import { ActionType, type ChatAction, type SessionAction } from '../../common/state/sessionActions.js';
import {
	ResponsePartKind,
	ToolCallConfirmationReason,
	ToolResultContentType,
	type AgentSelection,
	type MessageAttachment,
	type ModelSelection,
	type PendingMessage,
	type ToolResultContent,
} from '../../common/state/sessionState.js';
import type { ClientPluginCustomization, Customization } from '../../common/state/protocol/state.js';
import { ChildCustomizationType, CustomizationLoadStatus, CustomizationType, type SkillCustomization } from '../../common/state/protocol/channels-session/state.js';
import type { ISyncedCustomization } from '../../common/agentPluginManager.js';
import { ISessionDataService, type ISessionDatabase } from '../../common/sessionDataService.js';
import { FileEditTracker } from '../shared/fileEditTracker.js';
import { OpenPolvoApiClient } from './openPolvoApiClient.js';
import { buildDevStudioStreamOptions } from './openPolvoDevStudioPayload.js';
import { readDevProjectSetup, runDevProjectPostSetup } from './openPolvoDevProjectRunner.js';
import { buildOpenPolvoRequestContext, type IOpenPolvoRequestContext } from './openPolvoContext.js';
import { runDeskTool } from './deskToolRunner.js';

interface IOpenPolvoDevFileOp {
	readonly path: string;
	readonly content?: string;
	readonly op?: 'write' | 'mkdir' | 'delete';
}

interface IOpenPolvoSessionState {
	readonly session: URI;
	apiSessionId: string;
	modelId?: string;
	workingDirectory?: string;
	projectRootRel?: string;
	projectRootResolved?: boolean;
	projectRootSetup?: Promise<string | undefined>;
	abortController?: AbortController;
	editTracker?: FileEditTracker;
	databaseRef?: IReference<ISessionDatabase>;
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
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ISessionDataService private readonly _sessionDataService: ISessionDataService,
		@IFileService private readonly _fileService: IFileService,
	) {
		super();
		void this._api.ensureAuth().catch(err => {
			this._logService.warn(`[OpenPolvo] Auto-login inicial no agent host: ${err instanceof Error ? err.message : String(err)}`);
		});
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
		const databaseRef = this._sessionDataService.openDatabase(session);
		const editTracker = this._instantiationService.createInstance(FileEditTracker, session.toString(), databaseRef.object);
		const sessionState: IOpenPolvoSessionState = {
			session,
			apiSessionId: apiSession.id,
			modelId,
			workingDirectory,
			editTracker,
			databaseRef,
		};
		this._sessions.set(AgentSession.id(session), sessionState);
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
		const devStudio = await buildDevStudioStreamOptions(state.workingDirectory, state.apiSessionId);
		let markdownPartId: string | undefined;
		let lastDevWorkflowStepId: string | undefined;
		const pendingTools: Promise<void>[] = [];
		const appliedWritePaths = new Set<string>();

		try {
			await this._api.streamMessage(
				state.apiSessionId,
				promptWithContext,
				{
					modelId: state.modelId,
					devStudio,
				},
				async event => {
					switch (event.type) {
						case 'thinking':
							if (
								event.content
								&& event.agentEventType !== 'progress'
								&& !this._isDevWorkflowProgressLabel(event.content, event.payload?.step)
							) {
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
						case 'progress': {
							const step = String(event.payload?.step ?? '');
							if (step === 'dev_project_root') {
								const root = readProjectRootFromProgressPayload(event.payload);
								if (root) {
									pendingTools.push(this._scheduleProjectRoot(state, root));
								}
							}
							if (step.startsWith('dev_') && event.content && step !== lastDevWorkflowStepId) {
								lastDevWorkflowStepId = step;
								this._fireWorkflowStepTool(session, effectiveTurnId, event.content, step);
							}
							break;
						}
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
							await this._handleToolCall(state, event.payload);
							break;
						case 'file':
							if (event.file?.path) {
								appliedWritePaths.add(event.file.path.replace(/\\/g, '/'));
							}
							pendingTools.push(this._applyFile(session, state, effectiveTurnId, event.file));
							break;
						case 'file_edit':
							if (event.fileEdit?.path) {
								appliedWritePaths.add(event.fileEdit.path.replace(/\\/g, '/'));
							}
							pendingTools.push(this._applyFile(session, state, effectiveTurnId, event.fileEdit));
							break;
						case 'done':
							pendingTools.push((async () => {
								await this._bootstrapProjectRootFromMetadata(state, event.metadata);
								await this._applyPolvoCodeOpsFromMetadata(
									session,
									state,
									effectiveTurnId,
									event.metadata,
									appliedWritePaths,
								);
								await this._postDevProjectSetup(session, state, effectiveTurnId, event.metadata);
							})());
							this._fire(session, { type: ActionType.ChatTurnComplete, turnId: effectiveTurnId });
							return;
						case 'error':
							this._fire(session, {
								type: ActionType.ChatError,
								turnId: effectiveTurnId,
								error: { errorType: 'OpenPolvoError', message: event.error ?? 'Unknown error' },
							});
							this._fire(session, { type: ActionType.ChatTurnComplete, turnId: effectiveTurnId });
							return;
					}
				},
				state.abortController.signal,
			);
			await Promise.allSettled(pendingTools);
		} catch (err) {
			const raw = err instanceof Error ? err.message : String(err);
			const aborted = raw === 'terminated'
				|| (err instanceof Error && err.name === 'AbortError')
				|| raw.toLowerCase().includes('aborted');
			const message = aborted
				? 'O pedido foi interrompido (ligação SSE fechada ou cancelado). Se o workflow demorou muito, tente novamente — o servidor envia agora keepalive durante a geração.'
				: raw;
			this._logService.error(`[OpenPolvo] sendMessage failed: ${raw}`);
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
		const state = this._sessions.get(AgentSession.id(session));
		state?.databaseRef?.dispose();
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
		if (token?.trim()) {
			this._api.setToken(token.trim());
		} else {
			try {
				await this._api.ensureAuth();
			} catch (err) {
				this._logService.error(`[OpenPolvo] Agent authenticate failed: ${err instanceof Error ? err.message : String(err)}`);
				return false;
			}
		}
		void this._refreshModels();
		return true;
	}

	getCustomizations(): Customization[] {
		const skillsDir = path.join(process.cwd(), '.cursor', 'skills');
		if (!fs.existsSync(skillsDir)) {
			return [];
		}
		const children: SkillCustomization[] = [];
		for (const ent of fs.readdirSync(skillsDir, { withFileTypes: true })) {
			if (!ent.isDirectory()) {
				continue;
			}
			const skillMd = path.join(skillsDir, ent.name, 'SKILL.md');
			if (!fs.existsSync(skillMd)) {
				continue;
			}
			children.push({
				type: CustomizationType.Skill,
				id: `openpolvo-skill-${ent.name}`,
				uri: URI.file(skillMd),
				name: ent.name,
			});
		}
		if (children.length === 0) {
			return [];
		}
		return [{
			type: CustomizationType.Directory,
			id: 'openpolvo-dev-skills',
			uri: URI.file(skillsDir),
			name: 'OpenPolvo Dev Skills',
			enabled: true,
			load: { kind: CustomizationLoadStatus.Loaded },
			contents: CustomizationType.Skill satisfies ChildCustomizationType,
			writable: false,
			children,
		}];
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

	private _isDevWorkflowProgressLabel(content: string, step: unknown): boolean {
		if (typeof step === 'string' && step.startsWith('dev_')) {
			return true;
		}
		return /^(A |Concluído:)/i.test(content.trim());
	}

	/** Cada passo do dev workflow aparece como tool call separado (estilo Cursor). */
	private _fireWorkflowStepTool(session: URI, turnId: string, label: string, stepId: string): void {
		const toolCallId = generateUuid();
		const toolName = 'dev_workflow_step';
		this._fire(session, {
			type: ActionType.ChatToolCallStart,
			turnId,
			toolCallId,
			toolName,
			displayName: label,
		});
		this._fire(session, {
			type: ActionType.ChatToolCallReady,
			turnId,
			toolCallId,
			invocationMessage: label,
			confirmed: ToolCallConfirmationReason.NotNeeded,
		});
		this._fire(session, {
			type: ActionType.ChatToolCallComplete,
			turnId,
			toolCallId,
			result: {
				success: true,
				pastTenseMessage: label,
				content: [{ type: ToolResultContentType.Text, text: label }],
			},
			_meta: {
				ui: {
					toolName,
					step: stepId,
				},
			},
		});
	}

	/**
	 * Sinaliza ao workbench para abrir/atualizar o browser interno na URL do dev server.
	 * O consumo é feito por OpenPolvoDevExplorerContribution (browser layer), que executa
	 * o comando do browser integrado com reuseUrlFilter (mesmo tab → HMR ao vivo).
	 */
	private _firePreview(session: URI, turnId: string, previewUrl: string): void {
		const toolCallId = generateUuid();
		const label = localize('openPolvoDevPreviewReady', "Preview ao vivo: {0}", previewUrl);
		this._fire(session, {
			type: ActionType.ChatToolCallComplete,
			turnId,
			toolCallId,
			result: {
				success: true,
				pastTenseMessage: label,
				content: [{ type: ToolResultContentType.Text, text: previewUrl }],
			},
			_meta: {
				ui: {
					toolName: 'dev_preview',
					previewUrl,
				},
			},
		});
	}

	/** Mostra eventos do grafo (tool_call/tool_result/observation) como passos de raciocínio. */
	private _surfaceAgentEvent(session: URI, turnId: string, eventType: string | undefined, payload: Record<string, unknown> | undefined): void {
		if (!eventType || eventType === 'thought' || eventType === 'final') {
			return;
		}
		if (eventType === 'step_start' || eventType === 'step_complete') {
			return;
		}
		const step = payload && typeof payload.step === 'string' ? payload.step : undefined;
		const agent = payload && typeof payload.agent === 'string' ? payload.agent : undefined;
		const tool = payload && typeof payload.tool === 'string' ? payload.tool : undefined;
		let label: string;
		if (eventType === 'step_start') {
			label = step ?? agent ?? 'passo';
		} else if (eventType === 'step_complete') {
			label = `Concluído: ${step ?? agent ?? 'passo'}`;
		} else if (eventType === 'pause_for_input') {
			label = 'Aguardando confirmação…';
		} else if (eventType === 'workflow_error') {
			const detail = payload && typeof payload.detail === 'string' ? payload.detail : '';
			label = detail ? `⚠️ Erro no workflow: ${detail}` : '⚠️ Erro no workflow de desenvolvimento.';
		} else {
			label = tool ? `${eventType}: ${tool}` : eventType;
		}
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

	private async _scheduleProjectRoot(state: IOpenPolvoSessionState, requestedRoot: string): Promise<void> {
		if (!state.projectRootSetup) {
			state.projectRootSetup = this._ensureProjectRoot(state, requestedRoot);
		}
		await state.projectRootSetup;
	}

	private async _awaitProjectRoot(state: IOpenPolvoSessionState): Promise<void> {
		if (state.projectRootSetup) {
			await state.projectRootSetup;
		}
	}

	private async _bootstrapProjectRootFromMetadata(
		state: IOpenPolvoSessionState,
		metadata: Record<string, unknown> | undefined,
	): Promise<void> {
		const root = readProjectRootFromMetadata(metadata);
		if (!root) {
			return;
		}
		await this._scheduleProjectRoot(state, root);
	}

	private async _ensureProjectRoot(state: IOpenPolvoSessionState, requestedRoot: string): Promise<string | undefined> {
		if (state.projectRootResolved && state.projectRootRel) {
			return state.projectRootRel;
		}
		const base = normalizeProjectRoot(requestedRoot);
		if (!state.workingDirectory) {
			state.projectRootRel = base;
			state.projectRootResolved = true;
			return state.projectRootRel;
		}
		const segments = base.split('/').filter(Boolean);
		const slug = segments[segments.length - 1] ?? 'openpolvo-app';
		const parent = segments.length > 1 ? segments.slice(0, -1).join('/') : PROJECTS_PARENT_DIR;
		let candidate = base;
		let suffix = 0;
		while (await this._pathExists(path.join(state.workingDirectory, candidate))) {
			const pkgPath = path.join(state.workingDirectory, candidate, 'package.json');
			const hasProject = await this._pathExists(pkgPath);
			if (hasProject && suffix === 0) {
				break;
			}
			suffix += 1;
			candidate = `${parent}/${slug}-${suffix}`;
		}
		state.projectRootRel = candidate;
		state.projectRootResolved = true;
		let abs = state.workingDirectory;
		for (const seg of candidate.split('/').filter(Boolean)) {
			abs = path.join(abs, seg);
			try {
				await this._fileService.createFolder(URI.file(abs));
			} catch (err) {
				this._logService.warn(
					`[OpenPolvo] failed to create project root ${candidate}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
		return candidate;
	}

	private async _pathExists(absPath: string): Promise<boolean> {
		try {
			await this._fileService.stat(URI.file(absPath));
			return true;
		} catch {
			return false;
		}
	}

	private async _resolveDevRelativePath(
		state: IOpenPolvoSessionState,
		relPath: string,
	): Promise<string> {
		let normalized = normalizeDevRelativePath(relPath);
		const segments = normalized.split('/').filter(Boolean);
		const firstSeg = segments[0];
		const secondSeg = segments[1];
		const reservedRoots = new Set(['src', 'server', 'public', 'package.json']);
		const looksPrefixed =
			segments.length > 1
			&& firstSeg === PROJECTS_PARENT_DIR
			&& secondSeg
			&& !reservedRoots.has(secondSeg);
		const looksSlugPrefixed =
			segments.length > 1 && firstSeg && !reservedRoots.has(firstSeg) && firstSeg !== PROJECTS_PARENT_DIR;

		if (!state.projectRootResolved && looksPrefixed) {
			const rootPath = `${firstSeg}/${secondSeg}`;
			const unique = await this._ensureProjectRoot(state, rootPath);
			if (unique !== rootPath) {
				normalized = normalized.replace(rootPath, unique);
			}
		} else if (!state.projectRootResolved && looksSlugPrefixed) {
			const unique = await this._ensureProjectRoot(state, firstSeg);
			if (unique !== firstSeg) {
				normalized = [unique, ...segments.slice(1)].join('/');
			}
		} else if (
			state.projectRootRel
			&& normalized !== state.projectRootRel
			&& !normalized.startsWith(`${state.projectRootRel}/`)
		) {
			normalized = prefixDevRelativePath(state.projectRootRel, normalized);
		}
		return normalized;
	}

	private async _applyPolvoCodeOpsFromMetadata(
		session: URI,
		state: IOpenPolvoSessionState,
		turnId: string,
		metadata: Record<string, unknown> | undefined,
		appliedWritePaths: ReadonlySet<string>,
	): Promise<void> {
		const ops = metadata?.polvo_code_ops;
		if (!Array.isArray(ops)) {
			return;
		}
		for (const raw of ops) {
			if (!raw || typeof raw !== 'object') {
				continue;
			}
			const op = raw as Record<string, unknown>;
			const relPath = String(op.path ?? '').trim().replace(/\\/g, '/');
			if (!relPath) {
				continue;
			}
			const kind = op.op === 'mkdir' ? 'mkdir' : op.op === 'delete' ? 'delete' : 'write';
			if (kind === 'write') {
				if (appliedWritePaths.has(relPath)) {
					continue;
				}
				await this._applyFile(session, state, turnId, {
					path: relPath,
					content: String(op.content ?? ''),
					op: 'write',
				});
				continue;
			}
			if (kind === 'delete') {
				await this._applyFile(session, state, turnId, { path: relPath, op: 'delete' });
				continue;
			}
			await this._applyFile(session, state, turnId, { path: relPath, op: 'mkdir' });
		}
	}

	/**
	 * Aplica um ficheiro ou mkdir emitido pelo dev workflow no workspace local,
	 * com tracking before/after via {@link FileEditTracker} e sinalização
	 * {@link ActionType.ChatToolCallComplete} para diffs no workbench.
	 */
	private async _applyFile(
		session: URI,
		state: IOpenPolvoSessionState,
		turnId: string,
		file: IOpenPolvoDevFileOp | INormalizedStreamEvent['fileEdit'] | undefined,
	): Promise<void> {
		if (!isOpenPolvoDevWorkflowEnabledFromEnv()) {
			return;
		}
		if (!file?.path || !state.workingDirectory) {
			return;
		}
		await this._awaitProjectRoot(state);
		const relPath = await this._resolveDevRelativePath(state, file.path);
		const absPath = resolveWorkspaceFile(state.workingDirectory, relPath);
		if (!absPath) {
			this._logService.warn(`[OpenPolvo] rejected path outside workspace: ${file.path}`);
			return;
		}

		const op = file.op === 'mkdir' ? 'mkdir' : file.op === 'delete' ? 'delete' : 'write';
		const toolCallId = generateUuid();
		const toolName = op === 'mkdir' ? 'dev_mkdir' : op === 'delete' ? 'dev_file_delete' : 'dev_file_write';
		const displayName = op === 'mkdir'
			? localize('openPolvoDevMkdir', "Created folder")
			: op === 'delete'
				? localize('openPolvoDevFileDelete', "Deleted file")
				: localize('openPolvoDevFileWrite', "Applied file change");

		this._fire(session, {
			type: ActionType.ChatToolCallStart,
			turnId,
			toolCallId,
			toolName,
			displayName,
		});
		this._fire(session, {
			type: ActionType.ChatToolCallReady,
			turnId,
			toolCallId,
			invocationMessage: relPath,
			confirmed: ToolCallConfirmationReason.NotNeeded,
		});

		try {
			const tracker = state.editTracker;
			if (tracker) {
				await tracker.trackEditStart(absPath);
			}

			if (op === 'mkdir') {
				await this._fileService.createFolder(URI.file(absPath));
			} else if (op === 'delete') {
				await this._fileService.del(URI.file(absPath), { recursive: true, useTrash: true });
			} else {
				await this._fileService.createFolder(URI.file(path.dirname(absPath)));
				await this._fileService.writeFile(URI.file(absPath), VSBuffer.fromString(file.content ?? ''));
			}

			if (tracker) {
				await tracker.completeEdit(absPath);
			}

			const content: ToolResultContent[] = [];
			if (tracker) {
				const fileEdit = await tracker.takeCompletedEdit(
					turnId,
					toolCallId,
					absPath,
					op === 'mkdir' ? 'dev_mkdir' : 'dev_file_write',
					{ path: relPath, content: file.content },
					state.modelId,
				);
				if (fileEdit) {
					content.push(fileEdit);
				}
			}

			this._fire(session, {
				type: ActionType.ChatToolCallComplete,
				turnId,
				toolCallId,
				result: {
					success: true,
					pastTenseMessage: `${displayName}: ${relPath}`,
					content: content.length > 0 ? content : [{ type: ToolResultContentType.Text, text: relPath }],
				},
				_meta: {
					ui: {
						resourceUri: URI.file(absPath).toString(),
						toolName,
					},
				},
			});
		} catch (err) {
			this._logService.warn(`[OpenPolvo] failed to apply ${op} ${file.path}: ${err instanceof Error ? err.message : String(err)}`);
			this._fire(session, {
				type: ActionType.ChatToolCallComplete,
				turnId,
				toolCallId,
				result: {
					success: false,
					pastTenseMessage: `${displayName} failed`,
					error: { message: err instanceof Error ? err.message : String(err) },
				},
			});
		}
	}

	private async _postDevProjectSetup(
		session: URI,
		state: IOpenPolvoSessionState,
		turnId: string,
		metadata: Record<string, unknown> | undefined,
	): Promise<void> {
		if (!isOpenPolvoDevWorkflowEnabledFromEnv() || !state.workingDirectory) {
			return;
		}
		const setup = readDevProjectSetup(metadata);
		if (setup.projectRootRel && !state.projectRootResolved) {
			await this._scheduleProjectRoot(state, setup.projectRootRel);
		}
		const shouldOpenExplorer = setup.createProject || setup.openWorkspace;
		try {
			if (!setup.npmInstall && !setup.runDev) {
				return;
			}
			const result = await runDevProjectPostSetup(state.workingDirectory, setup);
			const messages: string[] = [];
			if (setup.npmInstall) {
				messages.push(localize('openPolvoDevNpmInstallDone', "Dependências instaladas com npm."));
			}
			if (result?.devStarted) {
				messages.push(localize('openPolvoDevServerStarted', "Servidor de desenvolvimento iniciado ({0}).", setup.devCommand));
			}
			if (messages.length > 0) {
				this._fireWorkflowStepTool(
					session,
					turnId,
					messages.join(' '),
					'dev_post_setup',
				);
			}
			// Preview ao vivo: abre/atualiza o browser interno na URL do dev server.
			if (result?.previewUrl) {
				this._firePreview(session, turnId, result.previewUrl);
			}
		} catch (err) {
			this._logService.warn(
				`[OpenPolvo] post project setup failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		} finally {
			if (shouldOpenExplorer && state.projectRootRel) {
				await this._openProjectInExplorer(session, state, turnId, true);
			}
		}
	}

	private async _openProjectInExplorer(
		session: URI,
		state: IOpenPolvoSessionState,
		turnId: string,
		forceReveal = false,
	): Promise<void> {
		if (!state.workingDirectory) {
			return;
		}
		const rel = state.projectRootRel;
		const absPath = rel
			? resolveWorkspaceFile(state.workingDirectory, rel)
			: state.workingDirectory;
		if (!absPath) {
			return;
		}
		try {
			await this._fileService.createFolder(URI.file(absPath));
		} catch {
			// pasta pode já existir
		}
		const toolCallId = generateUuid();
		const toolName = 'dev_project_root';
		this._fire(session, {
			type: ActionType.ChatToolCallComplete,
			turnId,
			toolCallId,
			result: {
				success: true,
				pastTenseMessage: localize('openPolvoDevProjectRoot', "Projecto criado em {0}", rel ?? '.'),
				content: [{ type: ToolResultContentType.Text, text: rel ?? '.' }],
			},
			_meta: {
				ui: {
					resourceUri: URI.file(absPath).toString(),
					toolName,
					revealFolder: true,
					addToWorkspace: true,
					forceReveal,
				},
			},
		});
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

function resolveWorkspaceFile(workspacePath: string, relPath: string): string | undefined {
	const target = path.resolve(workspacePath, relPath || '.');
	const root = path.resolve(workspacePath);
	if (target !== root && !target.startsWith(root + path.sep)) {
		return undefined;
	}
	return target;
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
