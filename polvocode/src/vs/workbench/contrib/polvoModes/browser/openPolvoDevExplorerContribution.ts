/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IAgentHostService } from '../../../../platform/agentHost/common/agentService.js';
import { ActionType } from '../../../../platform/agentHost/common/state/sessionActions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { BrowserViewCommandId } from '../../../../platform/browserView/common/browserView.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IExplorerService } from '../../files/browser/files.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceEditingService } from '../../../services/workspaces/common/workspaceEditing.js';

const DEV_TOOL_NAMES = new Set(['dev_file_write', 'dev_mkdir', 'dev_project_root']);

/**
 * Revela ficheiros gerados pelo dev workflow no Explorer (padrão Cursor/Claude Code).
 */
export class OpenPolvoDevExplorerContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.openPolvoDevExplorer';

	private _lastRevealUri: string | undefined;
	private _revealTimer: ReturnType<typeof setTimeout> | undefined;
	private _lastPreviewUrl: string | undefined;

	constructor(
		@IAgentHostService private readonly agentHostService: IAgentHostService,
		@IExplorerService private readonly explorerService: IExplorerService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IWorkspaceEditingService private readonly workspaceEditingService: IWorkspaceEditingService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();

		this._register(this.agentHostService.onDidAction(envelope => {
			if (envelope.action.type !== ActionType.ChatToolCallComplete) {
				return;
			}
			const action = envelope.action;
			if (!action.result?.success) {
				return;
			}
			const ui = action._meta?.ui as {
				previewUrl?: unknown;
				resourceUri?: string;
				toolName?: string;
				revealFolder?: boolean;
				addToWorkspace?: boolean;
				openFolder?: boolean;
				forceReveal?: boolean;
			} | undefined;
			// Preview ao vivo: abre/atualiza o browser integrado na URL do dev server.
			const previewUrl = ui?.previewUrl;
			if (typeof previewUrl === 'string' && previewUrl) {
				this._openPreview(previewUrl);
				return;
			}
			const resourceUri = ui?.resourceUri;
			const toolName = ui?.toolName;
			const revealFolder = ui?.revealFolder === true;
			const addToWorkspace = ui?.addToWorkspace === true;
			const openFolder = ui?.openFolder === true;
			const forceReveal = ui?.forceReveal === true;
			if (typeof resourceUri !== 'string' || !resourceUri) {
				return;
			}
			if (typeof toolName === 'string' && !DEV_TOOL_NAMES.has(toolName)) {
				return;
			}
			if (openFolder) {
				void this._openFolderAsWorkspace(URI.parse(resourceUri));
				return;
			}
			this._scheduleReveal(URI.parse(resourceUri), revealFolder, addToWorkspace, forceReveal);
		}));
	}

	private _scheduleReveal(resource: URI, revealFolder = false, addToWorkspace = false, forceReveal = false): void {
		if (!forceReveal && this._lastRevealUri === resource.toString()) {
			return;
		}
		this._lastRevealUri = resource.toString();
		if (this._revealTimer) {
			clearTimeout(this._revealTimer);
		}
		this._revealTimer = setTimeout(() => {
			this._revealTimer = undefined;
			void this._reveal(resource, revealFolder, addToWorkspace);
		}, 80);
	}

	/**
	 * Abre (ou reutiliza) o browser interno na URL do dev server. O `reuseUrlFilter`
	 * garante que o mesmo tab é reaproveitado — com HMR do Vite, o preview atualiza ao
	 * vivo sem abrir novos separadores.
	 */
	private _openPreview(url: string): void {
		const trimmed = url.trim();
		if (!trimmed) {
			return;
		}
		let parsed: URL;
		try {
			parsed = new URL(trimmed);
		} catch {
			return;
		}
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return;
		}
		if (this._lastPreviewUrl === trimmed) {
			return;
		}
		this._lastPreviewUrl = trimmed;
		try {
			let authorityFilter = parsed.origin;
			void this.commandService.executeCommand(BrowserViewCommandId.Open, {
				url: trimmed,
				reuseUrlFilter: authorityFilter,
				openToSide: true,
			});
		} catch {
			// browser integrado indisponível (ex.: build web) — best-effort
		}
	}

	private _normalizeFolderUri(uri: URI): string {
		return uri.toString().replace(/\/$/, '');
	}

	private _isWorkspaceFolderRoot(resource: URI): boolean {
		const target = this._normalizeFolderUri(resource);
		return this.workspaceContextService.getWorkspace().folders.some(
			f => this._normalizeFolderUri(f.uri) === target,
		);
	}

	private async _openFolderAsWorkspace(resource: URI): Promise<void> {
		try {
			const folders = this.workspaceContextService.getWorkspace().folders;
			const target = this._normalizeFolderUri(resource);
			if (
				this.workspaceContextService.getWorkbenchState() === WorkbenchState.FOLDER
				&& folders.length === 1
				&& this._normalizeFolderUri(folders[0].uri) !== target
			) {
				await this.workspaceEditingService.updateFolders(0, 1, [{ uri: resource }]);
				return;
			}
			await this.commandService.executeCommand('vscode.openFolder', resource, { forceReuseWindow: true });
		} catch {
			// best-effort
		}
	}

	private async _ensureInWorkspace(resource: URI, addToWorkspace: boolean): Promise<void> {
		if (!addToWorkspace) {
			return;
		}
		if (this._isWorkspaceFolderRoot(resource)) {
			return;
		}
		try {
			await this.workspaceEditingService.addFolders([{ uri: resource }]);
		} catch {
			// best-effort
		}
	}

	private async _reveal(resource: URI, revealFolder: boolean, addToWorkspace: boolean): Promise<void> {
		try {
			if (revealFolder) {
				await this._ensureInWorkspace(resource, addToWorkspace);
			}
			await this.explorerService.refresh();
			await this.explorerService.select(resource, true);
			if (!revealFolder && /\.(tsx|ts|jsx|js|css|json|md)$/i.test(resource.path)) {
				await this.editorService.openEditor({
					resource,
					options: { pinned: false, inactive: false },
				});
			}
		} catch {
			// best-effort
		}
	}

	override dispose(): void {
		if (this._revealTimer) {
			clearTimeout(this._revealTimer);
		}
		super.dispose();
	}
}

registerWorkbenchContribution2(
	OpenPolvoDevExplorerContribution.ID,
	OpenPolvoDevExplorerContribution,
	WorkbenchPhase.AfterRestored,
);
