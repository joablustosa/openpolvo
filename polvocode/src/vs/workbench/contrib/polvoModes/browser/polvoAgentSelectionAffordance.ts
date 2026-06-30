/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ContentWidgetPositionPreference, ICodeEditor, IContentWidget, IContentWidgetPosition } from '../../../../editor/browser/editorBrowser.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../../editor/browser/editorExtensions.js';
import { localize } from '../../../../nls.js';
import { IPolvoAgentChatContextService } from './polvoAgentChatContextService.js';
import { openPolvoAgentChat } from './polvoAgentSelectionActions.js';
import { IPolvoAgentConversationsService } from './polvoAgentConversationsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';

const $ = dom.$;

class PolvoSelectionAffordanceWidget extends Disposable implements IContentWidget {
	readonly allowEditorOverflow = true;
	readonly suppressMouseDown = false;

	private readonly _domNode: HTMLElement;
	private _position: IContentWidgetPosition | null = null;

	constructor(
		private readonly _editor: ICodeEditor,
		private readonly _contextService: IPolvoAgentChatContextService,
		private readonly _focusChat: () => Promise<void>,
	) {
		super();
		this._domNode = $('.polvo-selection-affordance');
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'polvo-selection-affordance-button';
		button.title = localize('polvoAddSelectionToChat', "Adicionar ao chat");
		button.setAttribute('aria-label', localize('polvoAddSelectionToChat', "Adicionar ao chat"));
		button.appendChild(renderIcon(Codicon.commentDiscussion));
		const label = dom.append(button, $('span.polvo-selection-affordance-label'));
		label.textContent = localize('polvoAddSelectionToChatShort', "Adicionar ao chat");
		this._register(dom.addDisposableListener(button, dom.EventType.CLICK, e => {
			e.preventDefault();
			e.stopPropagation();
			this._contextService.addFromEditorSelection(this._editor);
			void this._focusChat();
			this.hide();
		}));
		this._domNode.appendChild(button);
	}

	getId(): string {
		return 'polvo.selectionAffordance';
	}

	getDomNode(): HTMLElement {
		return this._domNode;
	}

	getPosition(): IContentWidgetPosition | null {
		return this._position;
	}

	showAtLine(lineNumber: number): void {
		this._position = {
			position: { lineNumber, column: 1 },
			preference: [ContentWidgetPositionPreference.ABOVE, ContentWidgetPositionPreference.BELOW],
		};
		if (!this._editor.getDomNode()?.contains(this._domNode)) {
			this._editor.addContentWidget(this);
		}
		this._editor.layoutContentWidget(this);
	}

	hide(): void {
		this._position = null;
		this._editor.removeContentWidget(this);
	}

	override dispose(): void {
		this.hide();
		super.dispose();
	}
}

export class PolvoAgentSelectionAffordanceContribution extends Disposable {
	static readonly ID = 'editor.contrib.polvoAgentSelectionAffordance';

	private readonly _widget = this._register(new MutableDisposable<PolvoSelectionAffordanceWidget>());
	private _debounceHandle: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly _editor: ICodeEditor,
		@IPolvoAgentChatContextService private readonly contextService: IPolvoAgentChatContextService,
		@IPolvoAgentConversationsService private readonly conversationsService: IPolvoAgentConversationsService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super();
		this._register(this._editor.onDidChangeCursorSelection(() => this.scheduleUpdate()));
		this._register(this._editor.onDidBlurEditorWidget(() => this.hideWidget()));
		this._register(this._editor.onDidDispose(() => this.hideWidget()));
	}

	private scheduleUpdate(): void {
		if (this._debounceHandle) {
			clearTimeout(this._debounceHandle);
		}
		this._debounceHandle = setTimeout(() => this.updateWidget(), 300);
	}

	private updateWidget(): void {
		const selection = this._editor.getSelection();
		const model = this._editor.getModel();
		if (!selection || !model || selection.isEmpty()) {
			this.hideWidget();
			return;
		}
		const text = model.getValueInRange(selection);
		if (!text.trim()) {
			this.hideWidget();
			return;
		}
		if (!this._widget.value) {
			this._widget.value = new PolvoSelectionAffordanceWidget(
				this._editor,
				this.contextService,
				() => openPolvoAgentChat(this.conversationsService, this.editorService),
			);
		}
		this._widget.value.showAtLine(selection.startLineNumber);
	}

	private hideWidget(): void {
		if (this._debounceHandle) {
			clearTimeout(this._debounceHandle);
			this._debounceHandle = undefined;
		}
		this._widget.clear();
	}
}

registerEditorContribution(
	PolvoAgentSelectionAffordanceContribution.ID,
	PolvoAgentSelectionAffordanceContribution,
	EditorContributionInstantiation.AfterFirstRender,
);
