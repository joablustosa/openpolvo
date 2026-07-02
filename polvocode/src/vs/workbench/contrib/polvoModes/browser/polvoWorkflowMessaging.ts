/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { isOpenPolvoConnectionError } from '../../../../platform/agentHost/common/openpolvoBackendProtocol.js';
import { formatResponseElapsedSeconds } from './polvoChatResponseTimer.js';
import { IOpenPolvoWorkbenchApiService, type IOpenPolvoWorkflowGraph } from './openPolvoWorkbenchApiService.js';
import { IPolvoWorkflowsService } from './polvoWorkflowsService.js';

const WORKFLOW_SYSTEM_PREFIX = localize(
	'polvoWorkflowAgentPrefix',
	"Você é um assistente que projeta workflows de automação. Descreva o workflow em passos claros, ferramentas necessárias e resultado esperado. Pedido do usuário:"
);

export interface ISendWorkflowOptions {
	/** Usa /v1/workflows/generate (backend oficial) em vez do chat livre. */
	readonly useBackend?: boolean;
	readonly signal?: AbortSignal;
}

export async function sendPolvoWorkflowMessage(
	workflowsService: IPolvoWorkflowsService,
	openPolvoApi: IOpenPolvoWorkbenchApiService,
	workflowId: string,
	userText: string,
	options?: ISendWorkflowOptions | AbortSignal,
): Promise<void> {
	const workflow = workflowsService.getWorkflow(workflowId);
	if (!workflow) {
		return;
	}

	// Compat: aceitar tanto a antiga assinatura (AbortSignal) como as novas opções.
	const opts: ISendWorkflowOptions = options instanceof AbortSignal ? { signal: options } : (options ?? {});
	const useBackend = opts.useBackend !== false;

	workflowsService.addMessage(workflowId, 'user', userText);
	workflowsService.addMessage(workflowId, 'assistant', '');
	const startedAt = Date.now();

	if (useBackend) {
		try {
			const result = await openPolvoApi.generateWorkflow(userText, workflow.modelId, workflow.title);
			const briefTitle = typeof result.brief?.title === 'string' ? result.brief.title.trim() : '';
			const briefDescription = typeof result.brief?.description === 'string' ? result.brief.description.trim() : '';
			const resolvedTitle = result.saved?.title || briefTitle || undefined;
			workflowsService.setGraph(workflowId, {
				graph: result.graph,
				backendId: result.saved?.id,
				stepBlueprint: result.stepBlueprint,
				description: briefDescription || undefined,
				title: resolvedTitle,
			});
			const summary = describeWorkflowGraph(result.graph, resolvedTitle);
			const message = result.assistantText?.trim() || summary.message;
			workflowsService.updateAssistantMessage(workflowId, message, { responseTimeSeconds: finalizeSeconds(startedAt) });
			workflowsService.setSummary(workflowId, briefDescription || summary.headline);
			return;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const isConnectionError = isOpenPolvoConnectionError(err);
			workflowsService.updateAssistantMessage(
				workflowId,
				isConnectionError
					? localize(
						'polvoWorkflowBackendUnavailable',
						"Não foi possível contactar o backend OpenPolvo ({0}). Verifique os terminais integrados \"OpenPolvo: Backend\" e \"OpenPolvo: Intelligence\".",
						message,
					)
					: localize('polvoWorkflowGenerateFailed', "Falha ao gerar automação no backend ({0}). A usar resposta em texto.", message),
			);
			if (isConnectionError) {
				return;
			}
			// Continua para o fallback de chat apenas em erros de negócio (ex.: JSON inválido).
		}
	}

	await streamWorkflowChat(workflowsService, openPolvoApi, workflowId, userText, startedAt, opts.signal);
}

function finalizeSeconds(startedAt: number): number {
	return Math.max(1, formatResponseElapsedSeconds(startedAt));
}

function describeWorkflowGraph(graph: IOpenPolvoWorkflowGraph, savedTitle?: string): { message: string; headline: string } {
	const nodeCount = graph.nodes?.length ?? 0;
	const edgeCount = graph.edges?.length ?? 0;
	const types = [...new Set((graph.nodes ?? []).map(n => n.type).filter(Boolean))];

	const lines: string[] = [];
	if (savedTitle) {
		lines.push(localize('polvoWorkflowSaved', "Automação \"{0}\" gerada e guardada no backend.", savedTitle));
	} else {
		lines.push(localize('polvoWorkflowGenerated', "Automação gerada com sucesso."));
	}
	lines.push('');
	lines.push(localize('polvoWorkflowNodesEdges', "Passos: {0} · Ligações: {1}", nodeCount, edgeCount));
	if (types.length > 0) {
		lines.push(localize('polvoWorkflowNodeTypes', "Ferramentas: {0}", types.join(', ')));
	}
	const steps = (graph.nodes ?? [])
		.map((n, i) => {
			const label = typeof n.data?.label === 'string' && n.data.label.trim() ? n.data.label.trim() : n.type;
			return `${i + 1}. ${label}`;
		})
		.slice(0, 20);
	if (steps.length > 0) {
		lines.push('');
		lines.push(...steps);
	}

	const headline = savedTitle
		? localize('polvoWorkflowHeadlineSaved', "{0} ({1} passos)", savedTitle, nodeCount)
		: localize('polvoWorkflowHeadline', "Automação com {0} passos", nodeCount);
	return { message: lines.join('\n'), headline };
}

async function streamWorkflowChat(
	workflowsService: IPolvoWorkflowsService,
	openPolvoApi: IOpenPolvoWorkbenchApiService,
	workflowId: string,
	userText: string,
	startedAt: number,
	signal?: AbortSignal,
): Promise<void> {
	const workflow = workflowsService.getWorkflow(workflowId);
	if (!workflow) {
		return;
	}

	let apiSessionId = workflow.apiSessionId;
	if (!apiSessionId) {
		apiSessionId = await openPolvoApi.createSession(workflow.title, workflow.modelId);
		workflowsService.setApiSessionId(workflowId, apiSessionId);
	}

	let assistantText = '';
	await openPolvoApi.streamMessage(
		apiSessionId,
		`${WORKFLOW_SYSTEM_PREFIX}\n\n${userText}`,
		workflow.modelId,
		event => {
			if (event.type === 'text_delta' && event.delta) {
				assistantText += event.delta;
				workflowsService.updateAssistantMessage(workflowId, assistantText);
			} else if (event.type === 'error') {
				workflowsService.updateAssistantMessage(workflowId, event.error ?? localize('polvoWorkflowUnknownError', "Erro desconhecido"));
			} else if (event.type === 'thinking' && event.content && !assistantText) {
				workflowsService.updateAssistantMessage(workflowId, event.content);
			}
		},
		signal,
	);

	const responseTimeSeconds = finalizeSeconds(startedAt);
	if (assistantText) {
		workflowsService.updateAssistantMessage(workflowId, assistantText, { responseTimeSeconds });
		const firstLine = assistantText.split('\n').find(line => line.trim().length > 0)?.trim();
		if (firstLine) {
			workflowsService.setSummary(workflowId, firstLine.length > 120 ? `${firstLine.slice(0, 120)}…` : firstLine);
		}
	} else {
		const last = workflowsService.getWorkflow(workflowId)?.messages.at(-1);
		if (last?.role === 'assistant' && !last.content) {
			workflowsService.updateAssistantMessage(
				workflowId,
				localize('polvoWorkflowEmptyResponse', "Sem resposta do servidor."),
				{ responseTimeSeconds },
			);
		} else if (last?.role === 'assistant') {
			workflowsService.updateAssistantMessage(workflowId, last.content, { responseTimeSeconds });
		}
	}
}
