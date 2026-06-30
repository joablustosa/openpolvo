/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Espelho de openpolvointeligence/graphs/dev_workflow/typescript/devAgentContracts.ts */

export interface DevAgentEvent {
	readonly event_id: string;
	readonly event_type: string;
	readonly timestamp: string;
	readonly payload: Record<string, unknown>;
}

export interface DevAgentThread {
	readonly thread_id: string;
	readonly conversation_id: string;
	readonly project_id?: string;
}

export type DevAgentStreamEvent =
	| { readonly type: 'progress'; readonly step: string; readonly label: string }
	| { readonly type: 'agent_event'; readonly event_id: string; readonly event_type: string; readonly payload: Record<string, unknown> }
	| { readonly type: 'file'; readonly file: { readonly path: string; readonly op: string; readonly content?: string } }
	| { readonly type: 'done'; readonly assistant_text: string; readonly metadata: Record<string, unknown> };
