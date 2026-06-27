/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IRequestService, asJson, type IRequestOptions } from '../../../../platform/request/common/request.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { OpenPolvoApiBaseUrlSettingId, OpenPolvoApiTokenSettingId } from '../common/openpolvoConfiguration.js';
import {
	BackendStreamNormalizer,
	buildChatBody,
	buildDeskContext,
	type INormalizedStreamEvent,
	type IOpenPolvoAttachment,
	OFFICIAL_API_DEFAULT_BASE_URL,
	OfficialRoutes,
	parseSseBuffer,
	resolveModelSelection,
} from '../../../../platform/agentHost/common/openpolvoBackendProtocol.js';
import { IOpenPolvoSignInService } from './openPolvoAuth.js';

export interface IOpenPolvoModel {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
	readonly provider?: string;
	readonly configured?: boolean;
}

/** Evento já normalizado a partir do contrato SSE do backend oficial. */
export type IOpenPolvoStreamEvent = INormalizedStreamEvent;

export interface IOpenPolvoWorkflowNode {
	readonly id: string;
	readonly type: string;
	readonly data?: Record<string, unknown>;
	readonly position?: { x: number; y: number };
}

export interface IOpenPolvoWorkflowGraph {
	readonly nodes: IOpenPolvoWorkflowNode[];
	readonly edges: Array<{ id: string; source: string; target: string }>;
}

export interface IWorkflowStepBlueprint {
	readonly id: string;
	readonly type: string;
	readonly label: string;
	readonly prompt: string;
	readonly rationale?: string;
}

export interface IOpenPolvoWorkflowGenerateResult {
	readonly graph: IOpenPolvoWorkflowGraph;
	readonly rawLlm: string;
	readonly saved?: { id: string; title: string };
	readonly brief?: Record<string, unknown>;
	readonly stepBlueprint?: IWorkflowStepBlueprint[];
	readonly assistantText?: string;
}

/** Workflow persistido no backend (DTO de `/v1/workflows`). */
export interface IOpenPolvoWorkflowRecord {
	readonly id: string;
	readonly title: string;
	readonly graph: IOpenPolvoWorkflowGraph;
	readonly createdAt?: string;
	readonly updatedAt?: string;
}

export interface IOpenPolvoLlmProfile {
	readonly id: string;
	readonly display_name: string;
	readonly provider: string;
	readonly model_id: string;
	readonly has_api_key: boolean;
}

export interface IOpenPolvoLlmProfileInput {
	readonly display_name: string;
	readonly provider: 'openai' | 'google';
	readonly model_id: string;
	readonly api_key: string;
}

export interface IOpenPolvoSmtpSettings {
	readonly host: string;
	readonly port: number;
	readonly username: string;
	readonly password_set: boolean;
	readonly from_email: string;
	readonly from_name: string;
	readonly use_tls: boolean;
	readonly email_chat_skip_confirmation?: boolean;
}

export interface IOpenPolvoSmtpInput {
	readonly host: string;
	readonly port: number;
	readonly username: string;
	readonly password?: string;
	readonly from_email: string;
	readonly from_name: string;
	readonly use_tls: boolean;
	readonly email_chat_skip_confirmation?: boolean;
}

interface IOfficialLlmProfile {
	id: string;
	display_name: string;
	provider?: string;
	model_id?: string;
	has_api_key?: boolean;
}

interface IOfficialWorkflowDTO {
	id: string;
	title?: string;
	graph?: IOpenPolvoWorkflowGraph;
	created_at?: string;
	updated_at?: string;
}

function toWorkflowRecord(dto: IOfficialWorkflowDTO): IOpenPolvoWorkflowRecord {
	return {
		id: dto.id,
		title: dto.title ?? 'Automação',
		graph: dto.graph ?? { nodes: [], edges: [] },
		createdAt: dto.created_at,
		updatedAt: dto.updated_at,
	};
}

const BASE_MODELS: IOpenPolvoModel[] = [
	{ id: 'auto', name: 'Automático', description: 'Routing automático (perfil/chave ou local)', provider: 'auto', configured: true },
	{ id: 'openai', name: 'OpenAI', description: 'OpenAI (chave configurada no backend)', provider: 'openai' },
	{ id: 'google', name: 'Gemini', description: 'Google Gemini', provider: 'google' },
	{ id: 'ollama', name: 'Ollama (local)', description: 'Modelo local via Ollama', provider: 'ollama' },
];

export const IOpenPolvoWorkbenchApiService = createDecorator<IOpenPolvoWorkbenchApiService>('openPolvoWorkbenchApiService');

export interface IOpenPolvoWorkbenchApiService {
	readonly _serviceBrand: undefined;

	listModels(): Promise<IOpenPolvoModel[]>;
	createSession(title?: string, model?: string): Promise<string>;
	streamMessage(
		sessionId: string,
		content: string,
		model: string | undefined,
		onEvent: (event: IOpenPolvoStreamEvent) => void,
		signal?: AbortSignal,
		attachments?: IOpenPolvoAttachment[],
	): Promise<void>;
	login(email: string, password: string): Promise<void>;
	register(email: string, password: string, name?: string): Promise<void>;
	generateWorkflow(prompt: string, model: string | undefined, saveTitle?: string): Promise<IOpenPolvoWorkflowGenerateResult>;
	listWorkflows(): Promise<IOpenPolvoWorkflowRecord[]>;
	getWorkflow(id: string): Promise<IOpenPolvoWorkflowRecord | undefined>;
	updateWorkflow(id: string, patch: { title?: string; graph?: IOpenPolvoWorkflowGraph }): Promise<IOpenPolvoWorkflowRecord>;
	deleteWorkflow(id: string): Promise<void>;
	listLlmProfiles(): Promise<IOpenPolvoLlmProfile[]>;
	createLlmProfile(input: IOpenPolvoLlmProfileInput): Promise<IOpenPolvoLlmProfile>;
	deleteLlmProfile(id: string): Promise<void>;
	getSmtpSettings(): Promise<IOpenPolvoSmtpSettings | undefined>;
	putSmtpSettings(input: IOpenPolvoSmtpInput): Promise<void>;
	testSmtp(): Promise<void>;
}

export class OpenPolvoWorkbenchApiService extends Disposable implements IOpenPolvoWorkbenchApiService {
	declare readonly _serviceBrand: undefined;

	private _token: string | undefined;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IRequestService private readonly requestService: IRequestService,
		@ILogService private readonly logService: ILogService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
		const configuredToken = this.configurationService.getValue<string>(OpenPolvoApiTokenSettingId);
		if (configuredToken) {
			this._token = configuredToken;
		}
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(OpenPolvoApiTokenSettingId)) {
				const token = this.configurationService.getValue<string>(OpenPolvoApiTokenSettingId);
				this._token = token || undefined;
			}
		}));
	}

	private get baseUrl(): string {
		return this.configurationService.getValue<string>(OpenPolvoApiBaseUrlSettingId) || OFFICIAL_API_DEFAULT_BASE_URL;
	}

	async listModels(): Promise<IOpenPolvoModel[]> {
		try {
			const context = await this.requestAuthorized({
				type: 'GET',
				url: `${this.baseUrl}${OfficialRoutes.llmProfiles}`,
				callSite: 'openPolvoWorkbenchApiService.listModels',
			});
			const profiles = await asJson<IOfficialLlmProfile[]>(context);
			const profileModels = (profiles ?? [])
				.filter(p => p?.id && p.display_name)
				.map<IOpenPolvoModel>(p => ({
					id: p.id,
					name: p.display_name,
					description: p.model_id,
					provider: p.provider,
					configured: p.has_api_key !== false,
				}));
			return [...BASE_MODELS, ...profileModels];
		} catch (err) {
			this.logService.warn(`[OpenPolvo] Failed to load models: ${err instanceof Error ? err.message : String(err)}`);
			return BASE_MODELS;
		}
	}

	async createSession(title?: string, _model?: string): Promise<string> {
		const context = await this.requestAuthorized({
			type: 'POST',
			url: `${this.baseUrl}${OfficialRoutes.conversations}`,
			headers: { 'Content-Type': 'application/json' },
			data: JSON.stringify({ title: title ?? 'Nova conversa' }),
			callSite: 'openPolvoWorkbenchApiService.createSession',
		});
		const body = await asJson<{ id: string }>(context);
		if (!body?.id) {
			throw new Error('OpenPolvo create conversation failed: missing id');
		}
		return body.id;
	}

	private resolveWorkspacePath(): string {
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length > 0) {
			return folders[0].uri.fsPath;
		}
		return '';
	}

	async streamMessage(
		sessionId: string,
		content: string,
		model: string | undefined,
		onEvent: (event: IOpenPolvoStreamEvent) => void,
		signal?: AbortSignal,
		attachments?: IOpenPolvoAttachment[],
	): Promise<void> {
		await this.ensureAuth();
		const deskContext = buildDeskContext(sessionId, this.resolveWorkspacePath(), 'agent', model);
		const body = buildChatBody(content, { modelId: model, deskContext, attachments });
		const doFetch = async () => fetch(`${this.baseUrl}${OfficialRoutes.conversationStream(sessionId)}`, {
			method: 'POST',
			headers: { ...this.authHeaders(), 'Content-Type': 'application/json', Accept: 'text/event-stream' },
			body: JSON.stringify(body),
			signal,
		});
		let response = await doFetch();
		if (response.status === 401) {
			await this.refreshAuth();
			response = await doFetch();
		}
		if (!response.ok || !response.body) {
			const text = await response.text().catch(() => '');
			throw new Error(`OpenPolvo message failed: ${response.status} ${text}`);
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		const normalizer = new BackendStreamNormalizer();
		let buffer = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			buffer += decoder.decode(value, { stream: true });
			const parsed = parseSseBuffer(buffer);
			buffer = parsed.rest;
			for (const raw of parsed.events) {
				for (const event of normalizer.normalize(raw)) {
					onEvent(event);
					if (event.done || event.type === 'error') {
						return;
					}
				}
			}
		}
	}

	async login(email: string, password: string): Promise<void> {
		const token = await this.requestLogin(email, password);
		this._token = token;
		await this.configurationService.updateValue(OpenPolvoApiTokenSettingId, token);
	}

	async register(email: string, password: string, name?: string): Promise<void> {
		const context = await this.requestService.request({
			type: 'POST',
			url: `${this.baseUrl}${OfficialRoutes.register}`,
			headers: { 'Content-Type': 'application/json' },
			data: JSON.stringify({ email, password, name: name ?? '' }),
			callSite: 'openPolvoWorkbenchApiService.register',
		}, CancellationToken.None);
		if (context.res.statusCode === 409) {
			throw new Error('Email already registered');
		}
		if (context.res.statusCode === 400) {
			throw new Error('Invalid registration data');
		}
		if (context.res.statusCode && context.res.statusCode >= 400) {
			throw new Error(`Registration failed (${context.res.statusCode})`);
		}
		await this.login(email, password);
	}

	async generateWorkflow(prompt: string, model: string | undefined, saveTitle?: string): Promise<IOpenPolvoWorkflowGenerateResult> {
		const selection = resolveModelSelection(model);
		const context = await this.requestAuthorized({
			type: 'POST',
			url: `${this.baseUrl}${OfficialRoutes.workflowsGenerate}`,
			headers: { 'Content-Type': 'application/json' },
			data: JSON.stringify({
				prompt,
				model_provider: selection.model_provider,
				llm_profile_id: selection.llm_profile_id,
				save_title: saveTitle,
			}),
			callSite: 'openPolvoWorkbenchApiService.generateWorkflow',
		});
		if (context.res.statusCode === 422) {
			const err = await asJson<{ error?: string; raw_llm?: string }>(context);
			throw new Error(err?.error ?? 'JSON inválido do modelo ao gerar automação');
		}
		if (context.res.statusCode && context.res.statusCode >= 400) {
			throw new Error(`generate workflow failed (${context.res.statusCode})`);
		}
		const body = await asJson<{
			graph?: IOpenPolvoWorkflowGraph;
			raw_llm?: string;
			saved?: { id: string; title: string };
			brief?: Record<string, unknown>;
			step_blueprint?: IWorkflowStepBlueprint[];
			assistant_text?: string;
		}>(context);
		if (!body?.graph) {
			throw new Error('OpenPolvo generate workflow failed: missing graph');
		}
		return {
			graph: body.graph,
			rawLlm: body.raw_llm ?? '',
			saved: body.saved,
			brief: body.brief,
			stepBlueprint: body.step_blueprint,
			assistantText: body.assistant_text,
		};
	}

	async listWorkflows(): Promise<IOpenPolvoWorkflowRecord[]> {
		const context = await this.requestAuthorized({
			type: 'GET',
			url: `${this.baseUrl}${OfficialRoutes.workflows}`,
			callSite: 'openPolvoWorkbenchApiService.listWorkflows',
		});
		if (context.res.statusCode && context.res.statusCode >= 400) {
			throw new Error(`list workflows failed (${context.res.statusCode})`);
		}
		const body = (await asJson<IOfficialWorkflowDTO[]>(context)) ?? [];
		return body.filter(w => w?.id).map(toWorkflowRecord);
	}

	async getWorkflow(id: string): Promise<IOpenPolvoWorkflowRecord | undefined> {
		const context = await this.requestAuthorized({
			type: 'GET',
			url: `${this.baseUrl}${OfficialRoutes.workflows}/${id}`,
			callSite: 'openPolvoWorkbenchApiService.getWorkflow',
		});
		if (context.res.statusCode === 404) {
			return undefined;
		}
		if (context.res.statusCode && context.res.statusCode >= 400) {
			throw new Error(`get workflow failed (${context.res.statusCode})`);
		}
		const body = await asJson<IOfficialWorkflowDTO>(context);
		return body?.id ? toWorkflowRecord(body) : undefined;
	}

	async updateWorkflow(id: string, patch: { title?: string; graph?: IOpenPolvoWorkflowGraph }): Promise<IOpenPolvoWorkflowRecord> {
		const context = await this.requestAuthorized({
			type: 'PATCH',
			url: `${this.baseUrl}${OfficialRoutes.workflows}/${id}`,
			headers: { 'Content-Type': 'application/json' },
			data: JSON.stringify(patch),
			callSite: 'openPolvoWorkbenchApiService.updateWorkflow',
		});
		if (context.res.statusCode && context.res.statusCode >= 400) {
			throw new Error(`update workflow failed (${context.res.statusCode})`);
		}
		const body = await asJson<IOfficialWorkflowDTO>(context);
		if (!body?.id) {
			throw new Error('update workflow failed: missing id');
		}
		return toWorkflowRecord(body);
	}

	async deleteWorkflow(id: string): Promise<void> {
		const context = await this.requestAuthorized({
			type: 'DELETE',
			url: `${this.baseUrl}${OfficialRoutes.workflows}/${id}`,
			callSite: 'openPolvoWorkbenchApiService.deleteWorkflow',
		});
		if (context.res.statusCode && context.res.statusCode >= 400 && context.res.statusCode !== 404) {
			throw new Error(`delete workflow failed (${context.res.statusCode})`);
		}
	}

	async listLlmProfiles(): Promise<IOpenPolvoLlmProfile[]> {
		const context = await this.requestAuthorized({
			type: 'GET',
			url: `${this.baseUrl}${OfficialRoutes.llmProfiles}`,
			callSite: 'openPolvoWorkbenchApiService.listLlmProfiles',
		});
		return (await asJson<IOpenPolvoLlmProfile[]>(context)) ?? [];
	}

	async createLlmProfile(input: IOpenPolvoLlmProfileInput): Promise<IOpenPolvoLlmProfile> {
		const context = await this.requestAuthorized({
			type: 'POST',
			url: `${this.baseUrl}${OfficialRoutes.llmProfiles}`,
			headers: { 'Content-Type': 'application/json' },
			data: JSON.stringify(input),
			callSite: 'openPolvoWorkbenchApiService.createLlmProfile',
		});
		if (context.res.statusCode && context.res.statusCode >= 400) {
			throw new Error(`create LLM profile failed (${context.res.statusCode})`);
		}
		const body = await asJson<IOpenPolvoLlmProfile>(context);
		if (!body?.id) {
			throw new Error('create LLM profile failed: missing id');
		}
		return body;
	}

	async deleteLlmProfile(id: string): Promise<void> {
		const context = await this.requestAuthorized({
			type: 'DELETE',
			url: `${this.baseUrl}${OfficialRoutes.llmProfiles}/${id}`,
			callSite: 'openPolvoWorkbenchApiService.deleteLlmProfile',
		});
		if (context.res.statusCode && context.res.statusCode >= 400) {
			throw new Error(`delete LLM profile failed (${context.res.statusCode})`);
		}
	}

	async getSmtpSettings(): Promise<IOpenPolvoSmtpSettings | undefined> {
		const context = await this.requestAuthorized({
			type: 'GET',
			url: `${this.baseUrl}${OfficialRoutes.smtp}`,
			callSite: 'openPolvoWorkbenchApiService.getSmtpSettings',
		});
		if (context.res.statusCode === 404) {
			return undefined;
		}
		return (await asJson<IOpenPolvoSmtpSettings>(context)) ?? undefined;
	}

	async putSmtpSettings(input: IOpenPolvoSmtpInput): Promise<void> {
		const context = await this.requestAuthorized({
			type: 'PUT',
			url: `${this.baseUrl}${OfficialRoutes.smtp}`,
			headers: { 'Content-Type': 'application/json' },
			data: JSON.stringify(input),
			callSite: 'openPolvoWorkbenchApiService.putSmtpSettings',
		});
		if (context.res.statusCode && context.res.statusCode >= 400) {
			throw new Error(`save SMTP failed (${context.res.statusCode})`);
		}
	}

	async testSmtp(): Promise<void> {
		const context = await this.requestAuthorized({
			type: 'POST',
			url: `${this.baseUrl}${OfficialRoutes.smtpTest}`,
			callSite: 'openPolvoWorkbenchApiService.testSmtp',
		});
		if (context.res.statusCode && context.res.statusCode >= 400) {
			throw new Error(`SMTP test failed (${context.res.statusCode})`);
		}
	}

	private async requestAuthorized(options: IRequestOptions) {
		await this.ensureAuth();
		let context = await this.requestService.request({
			...options,
			headers: { ...options.headers, ...this.authHeaders() },
		}, CancellationToken.None);
		if (context.res.statusCode === 401) {
			await this.refreshAuth();
			context = await this.requestService.request({
				...options,
				headers: { ...options.headers, ...this.authHeaders() },
			}, CancellationToken.None);
		}
		return context;
	}

	private async ensureAuth(): Promise<void> {
		if (this._token) {
			return;
		}
		const configuredToken = this.configurationService.getValue<string>(OpenPolvoApiTokenSettingId);
		if (configuredToken) {
			this._token = configuredToken;
			return;
		}
		const ok = await this.instantiationService.invokeFunction(accessor =>
			accessor.get(IOpenPolvoSignInService).ensureSignedIn()
		);
		if (!ok || !this._token) {
			throw new Error('OpenPolvo auto-login failed');
		}
	}

	private async refreshAuth(): Promise<void> {
		this._token = undefined;
		const ok = await this.instantiationService.invokeFunction(accessor =>
			accessor.get(IOpenPolvoSignInService).refreshSignedIn()
		);
		if (!ok) {
			throw new Error('OpenPolvo token refresh failed');
		}
		const token = this.configurationService.getValue<string>(OpenPolvoApiTokenSettingId);
		this._token = token || undefined;
	}

	private async requestLogin(email: string, password: string): Promise<string> {
		const context = await this.requestService.request({
			type: 'POST',
			url: `${this.baseUrl}${OfficialRoutes.login}`,
			headers: { 'Content-Type': 'application/json' },
			data: JSON.stringify({ email, password }),
			callSite: 'openPolvoWorkbenchApiService.login',
		}, CancellationToken.None);
		if (context.res.statusCode === 401) {
			throw new Error('Invalid email or password');
		}
		if (context.res.statusCode && context.res.statusCode >= 400) {
			throw new Error(`Login failed (${context.res.statusCode})`);
		}
		const body = await asJson<{ access_token: string }>(context);
		if (!body?.access_token) {
			throw new Error('OpenPolvo login failed: missing access_token');
		}
		return body.access_token;
	}

	private authHeaders(): Record<string, string> {
		if (!this._token) {
			throw new Error('OpenPolvo API token missing');
		}
		return { Authorization: `Bearer ${this._token}` };
	}
}

registerSingleton(IOpenPolvoWorkbenchApiService, OpenPolvoWorkbenchApiService, InstantiationType.Delayed);
