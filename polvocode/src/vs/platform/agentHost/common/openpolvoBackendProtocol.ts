/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Camada de compatibilidade com o backend oficial do OpenPolvo (`openpolvobackend` +
 * `openpolvointeligence`). Mantém-se livre de dependências de DOM/Node para poder ser
 * partilhada entre o serviço de browser (`polvoModes`) e o Agent Host (Node).
 *
 * O contrato de transporte (fetch/streams) vive nos ficheiros de cada camada; aqui
 * concentram-se apenas: rotas, tipos, construção de payload, mapeamento de modelo e a
 * normalização dos eventos SSE ricos do backend oficial para o formato simples que as
 * UIs do polvocode já consomem.
 */

// ── Rotas do backend oficial ─────────────────────────────────────────────────

export const OFFICIAL_API_DEFAULT_BASE_URL = 'http://127.0.0.1:8081';

export const OfficialRoutes = {
	login: '/v1/auth/login',
	register: '/v1/auth/register',
	me: '/v1/auth/me',
	conversations: '/v1/conversations',
	conversationMessages: (id: string) => `/v1/conversations/${id}/messages`,
	conversationStream: (id: string) => `/v1/conversations/${id}/messages/stream`,
	conversationAgentMemory: (id: string) => `/v1/conversations/${id}/agent-memory`,
	deskToolResult: (id: string) => `/v1/conversations/${id}/desk-tool-result`,
	llmProfiles: '/v1/llm/profiles',
	llmAgentPrefs: '/v1/llm/agent-prefs',
	smtp: '/v1/me/smtp',
	smtpTest: '/v1/me/smtp/test',
	workflows: '/v1/workflows',
	workflowsGenerate: '/v1/workflows/generate',
	workflowRun: (id: string) => `/v1/workflows/${id}/run`,
} as const;

// ── Tipos do contrato ────────────────────────────────────────────────────────

export type OfficialModelProvider = 'openai' | 'google' | 'ollama' | 'auto';

export interface IOfficialModelSelection {
	readonly model_provider: OfficialModelProvider;
	readonly llm_profile_id?: string;
}

export interface IOpenPolvoDeskContext {
	mode: 'agent' | 'code';
	workspace_path: string;
	conversation_id: string;
	model_provider?: string;
	/**
	 * Quem executa as tool_calls do agente Desk:
	 * - 'client' — o cliente executa e devolve via bridge (ex.: janela sessions);
	 * - 'server' — o Intelligence executa localmente (clientes sem runner de tools,
	 *   como o chat do Agent mode, que não trata eventos tool_call).
	 */
	tool_runner?: 'client' | 'server';
}

export interface IOpenPolvoConsoleLog {
	level: string;
	message: string;
	source?: string;
}

export interface IOpenPolvoAttachment {
	name: string;
	mime_type: string;
	data_base64: string;
}

export interface IOpenPolvoCodeReference {
	path: string;
	start_line: number;
	end_line: number;
	text: string;
}

export interface IOpenPolvoChatBody {
	text: string;
	model_provider?: OfficialModelProvider;
	llm_profile_id?: string;
	desk_context?: IOpenPolvoDeskContext;
	sandbox_project_id?: string;
	project_file_tree?: string[];
	project_files?: Record<string, string>;
	preview_console_logs?: IOpenPolvoConsoleLog[];
	dev_studio_context?: Record<string, unknown>;
	compile_log?: string;
	attachments?: IOpenPolvoAttachment[];
	code_references?: IOpenPolvoCodeReference[];
}

export interface IOfficialMessage {
	id?: string;
	role: string;
	content: string;
	metadata?: unknown;
}

/**
 * Evento normalizado consumido pelas UIs do polvocode. É um superconjunto do antigo
 * `IOpenPolvoStreamEvent` (`thinking` | `text_delta` | `done` | `error`), acrescentando
 * os eventos ricos do backend oficial (agent_event, file, tool_call, messages_saved).
 */
export interface INormalizedStreamEvent {
	type:
	| 'thinking'
	| 'text_delta'
	| 'done'
	| 'error'
	| 'progress'
	| 'agent_event'
	| 'file'
	| 'file_edit'
	| 'tool_call'
	| 'messages_saved';
	content?: string;
	delta?: string;
	error?: string;
	done?: boolean;
	agentEventType?: string;
	payload?: Record<string, unknown>;
	file?: { path: string; language?: string; content?: string; op?: 'write' | 'mkdir' | 'delete' };
	fileEdit?: {
		path: string;
		op?: 'write' | 'mkdir';
		added?: number;
		removed?: number;
		uri?: string;
	};
	messages?: IOfficialMessage[];
	metadata?: Record<string, unknown>;
}

export interface IOpenPolvoToolCall {
	id: string;
	tool: string;
	args: Record<string, unknown>;
	requiresClient: boolean;
}

// ── Mapeamento de modelo ─────────────────────────────────────────────────────

const PROVIDER_IDS = new Set<OfficialModelProvider>(['openai', 'google', 'ollama', 'auto']);

/**
 * Converte o `modelId` exibido na UI para a seleção esperada pelo backend oficial.
 * IDs de provider conhecidos viram `model_provider`; qualquer outro é tratado como
 * `llm_profile_id` (perfil com chave guardado no SQLite), com routing automático.
 */
export function resolveModelSelection(modelId: string | undefined): IOfficialModelSelection {
	const id = (modelId ?? '').trim();
	if (!id || id === 'polvo') {
		return { model_provider: 'auto' };
	}
	if (PROVIDER_IDS.has(id as OfficialModelProvider)) {
		return { model_provider: id as OfficialModelProvider };
	}
	return { model_provider: 'auto', llm_profile_id: id };
}

// ── Construção de payload ────────────────────────────────────────────────────

export interface IBuildChatBodyOptions {
	modelId?: string;
	deskContext?: IOpenPolvoDeskContext;
	devStudio?: Pick<
		IOpenPolvoChatBody,
		'sandbox_project_id' | 'project_file_tree' | 'project_files' | 'preview_console_logs' | 'dev_studio_context' | 'compile_log'
	>;
	attachments?: IOpenPolvoAttachment[];
	codeReferences?: IOpenPolvoCodeReference[];
}

export function buildChatBody(text: string, options: IBuildChatBodyOptions = {}): IOpenPolvoChatBody {
	const selection = resolveModelSelection(options.modelId);
	const body: IOpenPolvoChatBody = {
		text,
		model_provider: selection.model_provider,
	};
	if (selection.llm_profile_id) {
		body.llm_profile_id = selection.llm_profile_id;
	}
	if (options.deskContext) {
		body.desk_context = {
			...options.deskContext,
			model_provider: options.deskContext.model_provider ?? selection.model_provider,
		};
	}
	if (options.devStudio) {
		Object.assign(body, options.devStudio);
	}
	if (options.attachments && options.attachments.length > 0) {
		body.attachments = options.attachments;
	}
	if (options.codeReferences && options.codeReferences.length > 0) {
		body.code_references = options.codeReferences;
	}
	return body;
}

export function buildDeskContext(
	conversationId: string,
	workspacePath: string | undefined,
	mode: 'agent' | 'code' = 'agent',
	modelProvider?: string,
): IOpenPolvoDeskContext {
	return {
		mode,
		workspace_path: (workspacePath ?? '').trim(),
		conversation_id: conversationId,
		model_provider: modelProvider,
	};
}

// ── Parsing de SSE (string -> objetos JSON) ──────────────────────────────────

export interface ISseParseResult {
	readonly events: unknown[];
	readonly rest: string;
}

/**
 * Extrai eventos `data: {json}` de um buffer SSE. Devolve os objetos JSON já parseados
 * e o resto do buffer (linha incompleta) para a próxima iteração.
 */
export function parseSseBuffer(buffer: string): ISseParseResult {
	const events: unknown[] = [];
	const lines = buffer.split('\n');
	const rest = lines.pop() ?? '';
	for (const raw of lines) {
		const line = raw.trim();
		if (!line.startsWith('data:')) {
			continue;
		}
		const payload = line.slice('data:'.length).trim();
		if (!payload) {
			continue;
		}
		try {
			events.push(JSON.parse(payload));
		} catch {
			// linha malformada — ignorar
		}
	}
	return { events, rest };
}

// ── Normalização de eventos do backend oficial ───────────────────────────────

interface IRawOfficialEvent {
	type?: string;
	step?: string;
	label?: string;
	text?: string;
	delta?: string;
	token?: string;
	content?: string;
	assistant_text?: string;
	detail?: string;
	error?: string;
	metadata?: Record<string, unknown>;
	event_type?: string;
	payload?: Record<string, unknown>;
	file?: { path?: string; language?: string; content?: string; op?: 'write' | 'mkdir' };
	file_edit?: { path?: string; op?: 'write' | 'mkdir'; added?: number; removed?: number; uri?: string };
	messages?: IOfficialMessage[];
	done?: boolean;
}

/**
 * Normaliza os eventos ricos do `/v1/conversations/{id}/messages/stream` para o formato
 * simples consumido pelas UIs. É *stateful* por stream: se nenhum `text_delta` for emitido,
 * o texto final do evento `done` é convertido num `text_delta` sintético para que as UIs
 * que acumulam deltas mostrem a resposta.
 */
export class BackendStreamNormalizer {
	private _sawText = false;

	normalize(raw: unknown): INormalizedStreamEvent[] {
		if (!raw || typeof raw !== 'object') {
			return [];
		}
		const evt = raw as IRawOfficialEvent;
		const type = (evt.type ?? '').trim();

		switch (type) {
			case 'progress': {
				const label = (evt.label ?? evt.step ?? '').trim();
				const step = (evt.step ?? '').trim();
				const payload = {
					...(evt.payload ?? {}),
					...(step ? { step } : {}),
					...(label ? { label } : {}),
				};
				const out: INormalizedStreamEvent[] = [{ type: 'progress', content: label, payload }];
				if (label && !this._sawText) {
					out.push({ type: 'thinking', content: label, agentEventType: 'progress' });
				}
				return out;
			}
			case 'delta':
			case 'text_delta':
			case 'token': {
				const delta = evt.delta ?? evt.text ?? evt.token ?? '';
				if (!delta) {
					return [];
				}
				this._sawText = true;
				return [{ type: 'text_delta', delta }];
			}
			case 'thinking': {
				const content = (evt.content ?? evt.text ?? '').trim();
				return content ? [{ type: 'thinking', content }] : [];
			}
			case 'agent_event': {
				const eventType = (evt.event_type ?? '').trim();
				const payload = evt.payload ?? {};
				const out: INormalizedStreamEvent[] = [
					{ type: 'agent_event', agentEventType: eventType, payload },
				];
				if (eventType === 'thought') {
					const text = textFromPayload(payload);
					if (text && !this._sawText) {
						out.push({ type: 'thinking', content: text });
					}
				} else if (eventType === 'tool_call' && payload.requires_client === true) {
					out.push({ type: 'tool_call', payload });
				}
				return out;
			}
			case 'file': {
				const f = evt.file;
				if (!f?.path) {
					return [];
				}
				const op = f.op === 'mkdir' ? 'mkdir' : f.op === 'delete' ? 'delete' : 'write';
				if (op === 'write' && typeof f.content !== 'string') {
					return [];
				}
				return [{
					type: 'file',
					file: {
						path: f.path,
						language: f.language,
						content: f.content ?? '',
						op,
					},
				}];
			}
			case 'file_edit': {
				const edit = evt.file_edit;
				if (!edit?.path) {
					return [];
				}
				return [{
					type: 'file_edit',
					fileEdit: {
						path: edit.path,
						op: edit.op,
						added: typeof edit.added === 'number' ? edit.added : undefined,
						removed: typeof edit.removed === 'number' ? edit.removed : undefined,
						uri: typeof edit.uri === 'string' ? edit.uri : undefined,
					},
				}];
			}
			case 'messages_saved': {
				return [{ type: 'messages_saved', messages: evt.messages ?? [] }];
			}
			case 'done': {
				const assistantText = (evt.assistant_text ?? evt.content ?? '').trim();
				const out: INormalizedStreamEvent[] = [];
				if (assistantText && !this._sawText) {
					out.push({ type: 'text_delta', delta: assistantText });
				}
				this._sawText = true;
				out.push({ type: 'done', done: true, content: assistantText, metadata: evt.metadata });
				return out;
			}
			case 'error': {
				const message = (evt.detail ?? evt.error ?? '').trim() || 'Erro desconhecido';
				return [{ type: 'error', error: message }];
			}
			default:
				return [];
		}
	}
}

function textFromPayload(payload: Record<string, unknown>): string {
	const candidate = payload.text ?? payload.message ?? payload.content ?? payload.detail;
	return typeof candidate === 'string' ? candidate.trim() : '';
}

export function toToolCall(payload: Record<string, unknown> | undefined): IOpenPolvoToolCall | undefined {
	if (!payload) {
		return undefined;
	}
	const id = String(payload.id ?? '').trim();
	const tool = String(payload.tool ?? payload.name ?? '').trim();
	if (!id || !tool) {
		return undefined;
	}
	const args = (payload.args && typeof payload.args === 'object') ? payload.args as Record<string, unknown> : {};
	return { id, tool, args, requiresClient: payload.requires_client === true };
}

/** Login silencioso com credenciais locais (`openpolvobackend/.env` ou env vars). */
export async function performOpenPolvoLocalLogin(
	baseUrl: string,
	request: (url: string, init: RequestInit) => Promise<Response>,
	resolveCredentials: () => { email: string; password: string },
): Promise<string> {
	const { email, password } = resolveCredentials();
	const url = `${baseUrl.replace(/\/$/, '')}${OfficialRoutes.login}`;
	const res = await request(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password }),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`OpenPolvo local login failed: ${res.status} ${text}`);
	}
	const body = await res.json() as { access_token?: string };
	if (!body.access_token) {
		throw new Error('OpenPolvo local login failed: missing access_token');
	}
	return body.access_token;
}
