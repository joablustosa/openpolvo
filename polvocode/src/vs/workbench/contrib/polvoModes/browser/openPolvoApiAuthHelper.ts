/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IOpenPolvoSignInService } from './openPolvoAuth.js';

const AUTH_ERROR_PATTERN = /401|403|token missing|auto-login|unauthorized|não autorizado|sign in/i;

function isAuthError(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return AUTH_ERROR_PATTERN.test(message);
}

/** Garante JWT local antes de chamar a API; em erro de auth renova silenciosamente e repete. */
export async function withOpenPolvoApiAuth<T>(
	signInService: IOpenPolvoSignInService,
	fn: () => Promise<T>,
): Promise<T> {
	const signedIn = await signInService.ensureSignedIn();
	if (!signedIn) {
		throw new Error('OpenPolvo auto-login failed');
	}
	try {
		return await fn();
	} catch (err) {
		if (!isAuthError(err)) {
			throw err;
		}
		const refreshed = await signInService.refreshSignedIn();
		if (!refreshed) {
			throw err;
		}
		return await fn();
	}
}
