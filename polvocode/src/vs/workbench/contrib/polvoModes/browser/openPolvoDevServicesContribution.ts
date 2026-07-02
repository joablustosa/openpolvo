/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout } from '../../../../base/common/async.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { dirname } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';

const INITIAL_DELAY_MS = 800;
const HEALTH_TIMEOUT_MS = 2_000;

async function isServiceUp(url: string): Promise<boolean> {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
		return response.ok;
	} catch {
		return false;
	}
}

/**
 * Arranca Backend (:8081) e Intelligence (:8090) no terminal integrado do IDE
 * (sem janelas PowerShell externas), apenas em modo dev.
 */
export class OpenPolvoDevServicesContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.openPolvoDevServices';

	private _started = false;

	constructor(
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		if (this.environmentService.isBuilt) {
			return;
		}
		this._register(disposableTimeout(() => {
			void this.ensureDevServices();
		}, INITIAL_DELAY_MS));
	}

	private resolveRepoRoot(): string | undefined {
		const appRoot = this.environmentService.appRoot;
		if (!appRoot) {
			return undefined;
		}
		return dirname(appRoot);
	}

	private async ensureDevServices(): Promise<void> {
		if (this._started) {
			return;
		}
		const repoRoot = this.resolveRepoRoot();
		if (!repoRoot) {
			return;
		}
		this._started = true;

		const [backendUp, intelUp] = await Promise.all([
			isServiceUp('http://127.0.0.1:8081/healthz'),
			isServiceUp('http://127.0.0.1:8090/healthz'),
		]);

		if (backendUp && intelUp) {
			this.logService.info('[OpenPolvo] Dev services já activos (8081, 8090).');
			return;
		}

		const { ITerminalService } = await import('../../terminal/browser/terminal.js');
		const terminalService = this.instantiationService.invokeFunction(accessor => accessor.get(ITerminalService));

		if (!backendUp) {
			const cwd = URI.file(`${repoRoot}\\openpolvobackend`);
			const instance = await terminalService.createTerminal({
				config: { name: localize('openPolvoBackendTerminal', "OpenPolvo: Backend") },
				cwd,
			});
			terminalService.setActiveInstance(instance);
			await instance.sendText('go run ./cmd/openlaele-api', true);
			this.logService.info('[OpenPolvo] Backend a arrancar no terminal integrado (:8081).');
		}

		if (!intelUp) {
			const cwd = URI.file(`${repoRoot}\\openpolvointeligence`);
			const instance = await terminalService.createTerminal({
				config: { name: localize('openPolvoIntelTerminal', "OpenPolvo: Intelligence") },
				cwd,
			});
			await instance.sendText('uv run openpolvo-intel', true);
			this.logService.info('[OpenPolvo] Intelligence a arrancar no terminal integrado (:8090).');
		}
	}
}

registerWorkbenchContribution2(
	OpenPolvoDevServicesContribution.ID,
	OpenPolvoDevServicesContribution,
	WorkbenchPhase.AfterRestored,
);
