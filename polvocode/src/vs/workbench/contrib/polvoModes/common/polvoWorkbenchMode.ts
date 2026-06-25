/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';

export enum PolvoWorkbenchMode {
	Code = 'code',
	Agent = 'agent',
	Workflow = 'workflow',
}

export const PolvoWorkbenchModeContext = new RawContextKey<PolvoWorkbenchMode>('polvoWorkbenchMode', PolvoWorkbenchMode.Code);

export const IPolvoWorkbenchModeService = createDecorator<IPolvoWorkbenchModeService>('polvoWorkbenchModeService');

export interface IPolvoWorkbenchModeService {
	readonly _serviceBrand: undefined;

	readonly mode: PolvoWorkbenchMode;
	readonly onDidChangeMode: Event<PolvoWorkbenchMode>;

	setMode(mode: PolvoWorkbenchMode, options?: { force?: boolean }): void;
}
