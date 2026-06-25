/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getOpenPolvoApiBaseUrlFromEnv, getOpenPolvoApiTokenFromEnv } from '../../common/openpolvoConfiguration.js';
import {
	BackendStreamNormalizer,
	buildChatBody,
	type IBuildChatBodyOptions,
	type INormalizedStreamEvent,
	OfficialRoutes,
	parseSseBuffer,
} from '../../common/openpolvoBackendProtocol.js';

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
		throw new Error('OpenPolvo API token missing — sign in to OpenPolvo first');
	}

	async listModels(): Promise<IOpenPolvoApiModel[]> {
		await this.ensureAuth();
		try {
			const res = await fetch(`${this.baseUrl}${OfficialRoutes.llmProfiles}`, {
				headers: this._authHeaders(),
			});
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
		await this.ensureAuth();
		const res = await fetch(`${this.baseUrl}${OfficialRoutes.conversations}`, {
			method: 'POST',
			headers: { ...this._authHeaders(), 'Content-Type': 'application/json' },
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
		onEvent: (event: INormalizedStreamEvent) => void,
		signal?: AbortSignal,
	): Promise<void> {
		await this.ensureAuth();
		const body = buildChatBody(content, options);
		const res = await fetch(`${this.baseUrl}${OfficialRoutes.conversationStream(conversationId)}`, {
			method: 'POST',
			headers: { ...this._authHeaders(), 'Content-Type': 'application/json', Accept: 'text/event-stream' },
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
					if (event.type === 'done' || event.type === 'error') {
						return;
					}
				}
			}
		}
	}

	/** Devolve o resultado de uma tool local ao backend (bridge Desk). */
	async submitDeskToolResult(
		conversationId: string,
		callId: string,
		result: Record<string, unknown>,
		workspacePath?: string,
	): Promise<void> {
		await this.ensureAuth();
		const res = await fetch(`${this.baseUrl}${OfficialRoutes.deskToolResult(conversationId)}`, {
			method: 'POST',
			headers: { ...this._authHeaders(), 'Content-Type': 'application/json' },
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
