/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { OPENPOLVO_SIGN_IN_COMMAND_ID } from '../common/openpolvoConfiguration.js';
import { IOpenPolvoSignInService } from './openPolvoAuth.js';

class OpenPolvoSignInAction extends Action2 {

	constructor() {
		super({
			id: OPENPOLVO_SIGN_IN_COMMAND_ID,
			title: localize2('openpolvo.signIn', "Sign in to OpenPolvo"),
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<boolean> {
		const signInService = accessor.get(IOpenPolvoSignInService);
		return signInService.signIn();
	}
}

registerAction2(OpenPolvoSignInAction);
