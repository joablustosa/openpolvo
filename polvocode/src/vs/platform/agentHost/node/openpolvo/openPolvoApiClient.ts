/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getOpenPolvoApiBaseUrlFromEnv, getOpenPolvoApiTokenFromEnv, resolveOpenPolvoLocalCredentials } from '../../common/openpolvoConfiguration.js';
import {
	BackendStreamNormalizer,
	buildChatBody,
	type IBuildChatBodyOptions,
	type INormalizedStreamEvent,
	OfficialRoutes,
	parseSseBuffer,
	performOpenPolvoLocalLogin,
} from '../../common/openpolvoBackendProtocol.js';
import { Agent, fetch as undiciFetch } from 'undici';

/** Cliente HTTP sem timeout de body — streams dev podem durar vários minutos. */
const longStreamAgent = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

export interface IOpenPolvoApiModel {
	id: string;
	name: string;
	description?: string;
	provider?: string;
	configured?: boolean;
}

/** Mantido para compatibilidade com os consumidores; é o evento já normalizado. */
export type IOpenPolvoStreamEvent = INormalizedStreamEvent;

interface IOfficialLlmProfile {
	id: string;
	display_name: string;
	provider?: string;
	model_id?: string;
	has_api_key?: boolean;
}

const BASE_MODELS: IOpenPolvoApiModel[] = [
	{ id: 'auto', name: 'Automático', description: 'Routing automático (perfil/chave ou local)', provider: 'auto', configured: true },
	{ id: 'openai', name: 'OpenAI', description: 'OpenAI (chave configurada no backend)', provider: 'openai' },
	{ id: 'google', name: 'Gemini', description: 'Google Gemini', provider: 'google' },
	{ id: 'ollama', name: 'Ollama (local)', description: 'Modelo local via Ollama', provider: 'ollama' },
];

export class OpenPolvoApiClient {
	private _token: string | undefined = getOpenPolvoApiTokenFromEnv();

	constructor(private readonly baseUrl: string = getOpenPolvoApiBaseUrlFromEnv()) { }

	setToken(token: string): void {
		this._token = token;
	}

	async ensureAuth(): Promise<void> {
		if (this._token) {
			return;
		}
		this._token = await performOpenPolvoLocalLogin(this.baseUrl, (url, init) => fetch(url, init), resolveOpenPolvoLocalCredentials);
	}

	private async refreshAuth(): Promise<void> {
		this._token = await performOpenPolvoLocalLogin(this.baseUrl, (url, init) => fetch(url, init), resolveOpenPolvoLocalCredentials);
	}

	private async fetchAuthorized(url: string, init: RequestInit): Promise<Response> {
		await this.ensureAuth();
		let res = await fetch(url, { ...init, headers: { ...init.headers, ...this._authHeaders() } });
		if (res.status === 401) {
			await this.refreshAuth();
			res = await fetch(url, { ...init, headers: { ...init.headers, ...this._authHeaders() } });
		}
		return res;
	}

	async listModels(): Promise<IOpenPolvoApiModel[]> {
		try {
			const res = await this.fetchAuthorized(`${this.baseUrl}${OfficialRoutes.llmProfiles}`, {});
			if (!res.ok) {
				return BASE_MODELS;
			}
			const profiles = await res.json() as IOfficialLlmProfile[];
			const profileModels = (profiles ?? [])
				.filter(p => p?.id && p.display_name)
				.map<IOpenPolvoApiModel>(p => ({
					id: p.id,
					name: p.display_name,
					description: p.model_id,
					provider: p.provider,
					configured: p.has_api_key !== false,
				}));
			return [...BASE_MODELS, ...profileModels];
		} catch {
			return BASE_MODELS;
		}
	}

	/** Cria uma conversa no backend oficial e devolve o id. */
	async createSession(title?: string, _model?: string): Promise<{ id: string }> {
		const res = await this.fetchAuthorized(`${this.baseUrl}${OfficialRoutes.conversations}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title: title ?? 'Nova conversa' }),
		});
		if (!res.ok) {
			throw new Error(`OpenPolvo create conversation failed: ${res.status}`);
		}
		const body = await res.json() as { id: string };
		if (!body?.id) {
			throw new Error('OpenPolvo create conversation failed: missing id');
		}
		return body;
	}

	async streamMessage(
		conversationId: string,
		content: string,
		options: IBuildChatBodyOptions,
		onEvent: (event: INormalizedStreamEvent) => void | Promise<void>,
		signal?: AbortSignal,
	): Promise<void> {
		const body = buildChatBody(content, options);
		const res = await this.fetchAuthorizedStream(`${this.baseUrl}${OfficialRoutes.conversationStream(conversationId)}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
			body: JSON.stringify(body),
			signal,
		});
		if (!res.ok || !res.body) {
			const text = await res.text().catch(() => '');
			throw new Error(`OpenPolvo message failed: ${res.status} ${text}`);
		}

		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		const normalizer = new BackendStreamNormalizer();
		let buffer = '';
		let sawTerminal = false;

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
					await onEvent(event);
					if (event.type === 'done' || event.type === 'error') {
						sawTerminal = true;
						return;
					}
				}
			}
		}
		if (!sawTerminal) {
			onEvent({
				type: 'error',
				error: 'Stream terminou sem resposta do servidor. Verifique se o Intelligence (:8090) está activo.',
			});
		}
	}

	private async fetchAuthorizedStream(url: string, init: RequestInit): Promise<Response> {
		await this.ensureAuth();
		const headers = { ...init.headers as Record<string, string>, ...this._authHeaders() };
		let res = await undiciFetch(url, { ...init, headers, dispatcher: longStreamAgent } as RequestInit);
		if (res.status === 401) {
			await this.refreshAuth();
			const retryHeaders = { ...init.headers as Record<string, string>, ...this._authHeaders() };
			res = await undiciFetch(url, { ...init, headers: retryHeaders, dispatcher: longStreamAgent } as RequestInit);
		}
		return res as unknown as Response;
	}

	/** Devolve o resultado de uma tool local ao backend (bridge Desk). */
	async submitDeskToolResult(
		conversationId: string,
		callId: string,
		result: Record<string, unknown>,
		workspacePath?: string,
	): Promise<void> {
		const res = await this.fetchAuthorized(`${this.baseUrl}${OfficialRoutes.deskToolResult(conversationId)}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ call_id: callId, workspace_path: workspacePath, result }),
		});
		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw new Error(`OpenPolvo desk tool result failed: ${res.status} ${text}`);
		}
	}

	private _authHeaders(): Record<string, string> {
		if (!this._token) {
			throw new Error('OpenPolvo API token missing');
		}
		return { Authorization: `Bearer ${this._token}` };
	}
}
