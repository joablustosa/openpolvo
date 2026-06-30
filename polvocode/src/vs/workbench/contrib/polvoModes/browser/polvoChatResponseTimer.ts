/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { IntervalTimer } from '../../../../base/common/async.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import type { IPolvoConversationMessage } from './polvoAgentConversationsService.js';

const $ = dom.$;

export function formatResponseElapsedSeconds(startedAt: number): number {
	return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

export function isAssistantResponseLoading(
	message: IPolvoConversationMessage,
	isLast: boolean,
	isSending: boolean,
): boolean {
	if (!isLast || message.role !== 'assistant' || message.responseTimeSeconds !== undefined) {
		return false;
	}
	return (
		isSending && (
			!message.content
			|| !!message.pdfGenerating
			|| !!message.richFormatting
			|| (!!message.devFormatting && !message.devStepDone)
		)
	);
}

export function appendResponseTimerLabel(messageEl: HTMLElement, seconds: number, loading: boolean): void {
	const timer = dom.append(messageEl, $('.polvo-agent-chat-response-timer'));
	timer.textContent = loading
		? localize('polvoResponseElapsed', "{0}s", String(seconds))
		: localize('polvoResponseCompleted', "Resposta em {0}s", String(seconds));
}

export function renderLoadingPlaceholder(bubble: HTMLElement, seconds: number): void {
	const status = dom.append(bubble, $('.polvo-agent-chat-loading'));
	status.textContent = localize('polvoResponseThinking', "A responder… {0}s", String(seconds));
}

/** Atualiza o contador em tempo real enquanto a resposta está a ser gerada. */
export class PolvoChatResponseTimerController implements IDisposable {
	private startedAt: number | undefined;
	private readonly tick = new IntervalTimer();

	constructor(private readonly onTick: () => void) { }

	start(): void {
		this.startedAt = Date.now();
		this.tick.cancelAndSet(() => this.onTick(), 1000);
	}

	stop(): number | undefined {
		this.tick.cancel();
		if (this.startedAt === undefined) {
			return undefined;
		}
		const seconds = Math.max(1, formatResponseElapsedSeconds(this.startedAt));
		this.startedAt = undefined;
		return seconds;
	}

	getElapsedSeconds(): number {
		return this.startedAt ? formatResponseElapsedSeconds(this.startedAt) : 0;
	}

	isRunning(): boolean {
		return this.startedAt !== undefined;
	}

	dispose(): void {
		this.tick.dispose();
	}
}
