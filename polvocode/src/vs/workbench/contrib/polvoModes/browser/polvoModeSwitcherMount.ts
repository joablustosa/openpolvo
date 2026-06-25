/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { Parts, IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { PolvoWorkbenchModeSwitcher } from './polvoWorkbenchModeSwitcher.js';

export class PolvoModeSwitcherMountContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.polvoModeSwitcherMount';

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
		this.mountSwitcher();
	}

	private mountSwitcher(): void {
		const tryMount = (): boolean => {
			const titlebarRight = this.layoutService.getContainer(mainWindow, Parts.TITLEBAR_PART)?.querySelector('.titlebar-right');
			const workbench = this.layoutService.getContainer(mainWindow);
			const existingHost = workbench?.querySelector('.polvo-mode-switcher-host');

			if (titlebarRight) {
				if (existingHost && existingHost.parentElement !== titlebarRight) {
					existingHost.remove();
				}
				if (titlebarRight.querySelector(':scope > .polvo-mode-switcher-host')) {
					return true;
				}

				const host = dom.$('.polvo-mode-switcher-host.polvo-mode-switcher-host-titlebar-right');
				titlebarRight.insertBefore(host, titlebarRight.firstChild);

				const switcher = this._register(this.instantiationService.createInstance(PolvoWorkbenchModeSwitcher, true));
				host.appendChild(switcher.element);
				this._register({ dispose: () => host.remove() });
				return true;
			}

			const sidebar = this.layoutService.getContainer(mainWindow, Parts.SIDEBAR_PART);
			if (!sidebar || sidebar.querySelector(':scope > .polvo-mode-switcher-host')) {
				return !!sidebar?.querySelector(':scope > .polvo-mode-switcher-host');
			}

			const host = dom.$('.polvo-mode-switcher-host');
			sidebar.insertBefore(host, sidebar.firstChild);

			const switcher = this._register(this.instantiationService.createInstance(PolvoWorkbenchModeSwitcher, false));
			host.appendChild(switcher.element);
			this._register({ dispose: () => host.remove() });
			return true;
		};

		if (!tryMount()) {
			let attempts = 0;
			let timeoutHandle: number | undefined;
			const retry = () => {
				attempts++;
				if (tryMount() || attempts >= 20) {
					return;
				}
				timeoutHandle = mainWindow.setTimeout(retry, 100);
			};
			timeoutHandle = mainWindow.setTimeout(retry, 100);
			this._register({ dispose: () => {
				if (timeoutHandle !== undefined) {
					mainWindow.clearTimeout(timeoutHandle);
				}
			} });
		}
	}
}

registerWorkbenchContribution2(PolvoModeSwitcherMountContribution.ID, PolvoModeSwitcherMountContribution, WorkbenchPhase.AfterRestored);
