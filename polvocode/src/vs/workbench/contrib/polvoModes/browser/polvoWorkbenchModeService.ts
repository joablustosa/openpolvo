/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IPolvoWorkbenchModeService, PolvoWorkbenchMode, PolvoWorkbenchModeContext } from '../common/polvoWorkbenchMode.js';

const STORAGE_KEY = 'polvo.workbench.mode';

export class PolvoWorkbenchModeService extends Disposable implements IPolvoWorkbenchModeService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeMode = this._register(new Emitter<PolvoWorkbenchMode>());
	readonly onDidChangeMode: Event<PolvoWorkbenchMode> = this._onDidChangeMode.event;

	private _mode: PolvoWorkbenchMode;
	private readonly modeContextKey: IContextKey<PolvoWorkbenchMode>;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();

		const stored = this.storageService.get(STORAGE_KEY, StorageScope.PROFILE);
		// Always boot in Code mode to avoid breaking workbench restoration.
		// The user can switch modes via the sidebar tabs after startup.
		this._mode = PolvoWorkbenchMode.Code;
		void stored;
		this.modeContextKey = PolvoWorkbenchModeContext.bindTo(contextKeyService);
		this.modeContextKey.set(this._mode);
	}

	get mode(): PolvoWorkbenchMode {
		return this._mode;
	}

	setMode(mode: PolvoWorkbenchMode, options?: { force?: boolean }): void {
		const unchanged = this._mode === mode;
		if (unchanged && !options?.force) {
			return;
		}
		if (!unchanged) {
			this._mode = mode;
			this.modeContextKey.set(mode);
			this.storageService.store(STORAGE_KEY, mode, StorageScope.PROFILE, StorageTarget.USER);
		}
		this._onDidChangeMode.fire(mode);
	}
}

registerSingleton(IPolvoWorkbenchModeService, PolvoWorkbenchModeService, InstantiationType.Delayed);
