/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/polvoModes.css';
import * as dom from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { PolvoWorkbenchMode, IPolvoWorkbenchModeService } from '../common/polvoWorkbenchMode.js';
import { POLVO_OPEN_AGENT_MODE_COMMAND_ID, POLVO_OPEN_CODE_MODE_COMMAND_ID, POLVO_OPEN_WORKFLOW_MODE_COMMAND_ID } from './polvoModeCommands.js';

const $ = dom.$;

interface IModeTab {
	readonly mode: PolvoWorkbenchMode;
	readonly label: string;
	readonly icon: ThemeIcon;
	readonly commandId: string;
}

const MODE_TABS: readonly IModeTab[] = [
	{ mode: PolvoWorkbenchMode.Agent, label: localize('polvoMode.agent', "Agente"), icon: Codicon.commentDiscussion, commandId: POLVO_OPEN_AGENT_MODE_COMMAND_ID },
	{ mode: PolvoWorkbenchMode.Workflow, label: localize('polvoMode.workflow', "Automações"), icon: Codicon.checklist, commandId: POLVO_OPEN_WORKFLOW_MODE_COMMAND_ID },
	{ mode: PolvoWorkbenchMode.Code, label: localize('polvoMode.code', "Code"), icon: Codicon.code, commandId: POLVO_OPEN_CODE_MODE_COMMAND_ID },
];

export class PolvoWorkbenchModeSwitcher extends Disposable {
	readonly element: HTMLElement;

	private readonly tabElements = new Map<PolvoWorkbenchMode, HTMLElement>();

	constructor(
		labeled: boolean,
		@ICommandService private readonly commandService: ICommandService,
		@IPolvoWorkbenchModeService private readonly modeService: IPolvoWorkbenchModeService,
		@IHoverService private readonly hoverService: IHoverService,
	) {
		super();

		this.element = $('.polvo-mode-switcher');
		if (labeled) {
			this.element.classList.add('polvo-mode-switcher-labeled');
		}

		const tabsContainer = dom.append(this.element, $('.polvo-mode-switcher-tabs'));

		for (const tab of MODE_TABS) {
			const tabElement = dom.append(tabsContainer, $('.polvo-mode-tab'));
			tabElement.setAttribute('role', 'tab');
			tabElement.setAttribute('aria-label', tab.label);
			tabElement.dataset.mode = tab.mode;

			const icon = dom.append(tabElement, $('.polvo-mode-tab-icon'));
			icon.classList.add(...ThemeIcon.asClassNameArray(tab.icon));

			if (labeled) {
				const label = dom.append(tabElement, $('span.polvo-mode-tab-label'));
				label.textContent = tab.label;
			}

			this._register(this.hoverService.setupManagedHover(getDefaultHoverDelegate('element'), tabElement, tab.label));
			this._register(dom.addDisposableListener(tabElement, dom.EventType.MOUSE_DOWN, e => {
				if (e.button === 0) {
					e.preventDefault();
					e.stopPropagation();
					void this.commandService.executeCommand(tab.commandId);
				}
			}));
			this._register(dom.addDisposableListener(tabElement, dom.EventType.KEY_DOWN, e => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					void this.commandService.executeCommand(tab.commandId);
				}
			}));

			tabElement.tabIndex = 0;
			this.tabElements.set(tab.mode, tabElement);
		}

		this._register(this.modeService.onDidChangeMode(mode => this.updateActiveTab(mode)));
		this.updateActiveTab(this.modeService.mode);
	}

	private updateActiveTab(activeMode: PolvoWorkbenchMode): void {
		for (const [mode, element] of this.tabElements) {
			element.classList.toggle('active', mode === activeMode);
			element.setAttribute('aria-selected', String(mode === activeMode));
		}
	}
}
