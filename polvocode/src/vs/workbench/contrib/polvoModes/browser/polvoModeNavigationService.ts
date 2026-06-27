/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IPolvoWorkbenchModeService, PolvoWorkbenchMode } from '../common/polvoWorkbenchMode.js';
import { IOpenPolvoSignInService } from './openPolvoAuth.js';

export const IPolvoModeNavigationService = createDecorator<IPolvoModeNavigationService>('polvoModeNavigationService');

export type PolvoModeLayoutApplier = (mode: PolvoWorkbenchMode) => Promise<void>;

export interface IPolvoModeNavigationService {
	readonly _serviceBrand: undefined;

	readonly onDidRegisterApplier: Event<void>;

	registerLayoutApplier(applier: PolvoModeLayoutApplier): IDisposable;
	navigateTo(mode: PolvoWorkbenchMode): Promise<void>;
}

export class PolvoModeNavigationService extends Disposable implements IPolvoModeNavigationService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidRegisterApplier = this._register(new Emitter<void>());
	readonly onDidRegisterApplier = this._onDidRegisterApplier.event;

	private applier: PolvoModeLayoutApplier | undefined;
	private pendingMode: PolvoWorkbenchMode | undefined;

	constructor(
		@IPolvoWorkbenchModeService private readonly modeService: IPolvoWorkbenchModeService,
		@IOpenPolvoSignInService private readonly signInService: IOpenPolvoSignInService,
	) {
		super();
	}

	registerLayoutApplier(applier: PolvoModeLayoutApplier): IDisposable {
		this.applier = applier;
		this._onDidRegisterApplier.fire();
		const pending = this.pendingMode;
		if (pending !== undefined) {
			this.pendingMode = undefined;
			void this.navigateTo(pending);
		}
		return {
			dispose: () => {
				if (this.applier === applier) {
					this.applier = undefined;
				}
			}
		};
	}

	async navigateTo(mode: PolvoWorkbenchMode): Promise<void> {
		if (!this.applier) {
			this.pendingMode = mode;
			return;
		}

		void this.signInService.ensureSignedIn();

		this.modeService.setMode(mode, { force: true });
		await this.applier(mode);
	}
}

registerSingleton(IPolvoModeNavigationService, PolvoModeNavigationService, InstantiationType.Delayed);
