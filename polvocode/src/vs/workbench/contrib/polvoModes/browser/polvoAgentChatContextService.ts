/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodeEditor, isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

export const MAX_CODE_REFERENCE_TEXT_BYTES = 8 * 1024;
export const CODE_REFERENCE_PREVIEW_CHARS = 200;

export interface IPolvoCodeReference {
	readonly uri: URI;
	readonly relativePath: string;
	readonly startLine: number;
	readonly endLine: number;
	readonly text: string;
}

export interface IPolvoCodeReferenceMeta {
	readonly path: string;
	readonly startLine: number;
	readonly endLine: number;
	readonly preview: string;
}

export const IPolvoAgentChatContextService = createDecorator<IPolvoAgentChatContextService>('polvoAgentChatContextService');

export interface IPolvoAgentChatContextService {
	readonly _serviceBrand: undefined;
	readonly pendingReferences: readonly IPolvoCodeReference[];
	readonly onDidChangePendingReferences: Event<void>;
	addReference(ref: IPolvoCodeReference): void;
	addFromEditorSelection(editor?: ICodeEditor): IPolvoCodeReference | undefined;
	removeReference(index: number): void;
	clearPendingReferences(): void;
	consumePendingReferences(): IPolvoCodeReference[];
	toMeta(ref: IPolvoCodeReference): IPolvoCodeReferenceMeta;
}

export function capCodeReferenceText(text: string, maxBytes = MAX_CODE_REFERENCE_TEXT_BYTES): string {
	const encoder = new TextEncoder();
	const bytes = encoder.encode(text);
	if (bytes.length <= maxBytes) {
		return text;
	}
	let end = text.length;
	while (end > 0 && encoder.encode(text.slice(0, end)).length > maxBytes) {
		end--;
	}
	return text.slice(0, end);
}

export function readCodeReferenceFromEditor(
	editor: ICodeEditor,
	workspaceContextService: IWorkspaceContextService,
): IPolvoCodeReference | undefined {
	const model = editor.getModel();
	const selection = editor.getSelection();
	if (!model || !selection || selection.isEmpty()) {
		return undefined;
	}
	const text = model.getValueInRange(selection);
	if (!text.trim()) {
		return undefined;
	}
	const uri = model.uri;
	const relativePath = workspaceContextService.asRelativePath(uri) || uri.fsPath.replace(/\\/g, '/');
	const startLine = selection.startLineNumber;
	const endLine = selection.endLineNumber;
	return {
		uri,
		relativePath,
		startLine,
		endLine,
		text: capCodeReferenceText(text),
	};
}

export class PolvoAgentChatContextService extends Disposable implements IPolvoAgentChatContextService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangePendingReferences = this._register(new Emitter<void>());
	readonly onDidChangePendingReferences = this._onDidChangePendingReferences.event;

	private _pending: IPolvoCodeReference[] = [];

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
	) {
		super();
	}

	get pendingReferences(): readonly IPolvoCodeReference[] {
		return this._pending;
	}

	addReference(ref: IPolvoCodeReference): void {
		const dup = this._pending.some(
			p => p.relativePath === ref.relativePath && p.startLine === ref.startLine && p.endLine === ref.endLine,
		);
		if (dup) {
			return;
		}
		this._pending.push(ref);
		this._onDidChangePendingReferences.fire();
	}

	addFromEditorSelection(editor?: ICodeEditor): IPolvoCodeReference | undefined {
		const active = editor ?? this.getActiveCodeEditor();
		if (!active) {
			return undefined;
		}
		const ref = readCodeReferenceFromEditor(active, this.workspaceContextService);
		if (ref) {
			this.addReference(ref);
		}
		return ref;
	}

	removeReference(index: number): void {
		if (index < 0 || index >= this._pending.length) {
			return;
		}
		this._pending.splice(index, 1);
		this._onDidChangePendingReferences.fire();
	}

	clearPendingReferences(): void {
		if (this._pending.length === 0) {
			return;
		}
		this._pending = [];
		this._onDidChangePendingReferences.fire();
	}

	consumePendingReferences(): IPolvoCodeReference[] {
		const out = [...this._pending];
		this.clearPendingReferences();
		return out;
	}

	toMeta(ref: IPolvoCodeReference): IPolvoCodeReferenceMeta {
		const preview = ref.text.length > CODE_REFERENCE_PREVIEW_CHARS
			? `${ref.text.slice(0, CODE_REFERENCE_PREVIEW_CHARS)}…`
			: ref.text;
		return {
			path: ref.relativePath,
			startLine: ref.startLine,
			endLine: ref.endLine,
			preview,
		};
	}

	private getActiveCodeEditor(): ICodeEditor | undefined {
		const control = this.editorService.activeTextEditorControl;
		if (isCodeEditor(control)) {
			return control;
		}
		return undefined;
	}
}

registerSingleton(IPolvoAgentChatContextService, PolvoAgentChatContextService, InstantiationType.Delayed);
