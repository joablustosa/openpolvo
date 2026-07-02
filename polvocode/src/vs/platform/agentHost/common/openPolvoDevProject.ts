/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Pasta padrão para novas apps geradas dentro de um workspace aberto. */
export const PROJECTS_PARENT_DIR = 'projects';

const DEFAULT_PROJECT_ROOT = 'openpolvo-app';

export function slugifyProjectTitle(title: string | undefined): string {
	const raw = (title ?? '').trim().toLowerCase()
		.replace(/[^\w\s-]/g, '')
		.replace(/[\s_-]+/g, '-')
		.replace(/^-+|-+$/g, '');
	const slug = raw.slice(0, 48);
	return slug || DEFAULT_PROJECT_ROOT;
}

export function normalizeDevRelativePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

/** Raiz relativa padrão: `projects/<slug>/`. */
export function buildProjectRootPath(slugOrTitle: string): string {
	const norm = normalizeDevRelativePath(slugOrTitle);
	if (!norm) {
		return `${PROJECTS_PARENT_DIR}/${DEFAULT_PROJECT_ROOT}`;
	}
	if (norm.startsWith(`${PROJECTS_PARENT_DIR}/`)) {
		const parts = norm.split('/').filter(Boolean);
		if (parts.length >= 2) {
			parts[parts.length - 1] = slugifyProjectTitle(parts[parts.length - 1]);
			return parts.join('/');
		}
	}
	const slug = norm.includes('/') ? slugifyProjectTitle(norm.split('/').pop()!) : slugifyProjectTitle(norm);
	return `${PROJECTS_PARENT_DIR}/${slug}`;
}

export function normalizeProjectRoot(requested: string | undefined): string {
	if (!requested?.trim()) {
		return buildProjectRootPath(DEFAULT_PROJECT_ROOT);
	}
	const norm = normalizeDevRelativePath(requested);
	if (norm.startsWith(`${PROJECTS_PARENT_DIR}/`)) {
		return norm;
	}
	if (norm.includes('/')) {
		return buildProjectRootPath(norm);
	}
	return buildProjectRootPath(slugifyProjectTitle(norm));
}

export function prefixDevRelativePath(projectRoot: string, relPath: string): string {
	const root = normalizeDevRelativePath(projectRoot);
	const rel = normalizeDevRelativePath(relPath);
	if (!root) {
		return rel;
	}
	if (!rel || rel === root || rel.startsWith(`${root}/`)) {
		return rel;
	}
	return `${root}/${rel}`;
}

export function readProjectRootFromMetadata(metadata: Record<string, unknown> | undefined): string | undefined {
	if (!metadata) {
		return undefined;
	}
	const direct = metadata.polvo_code_project_root;
	if (typeof direct === 'string' && direct.trim()) {
		return normalizeDevRelativePath(direct);
	}
	if (!metadata.polvo_code_create_project) {
		return undefined;
	}
	const title = typeof metadata.polvo_code_project_title === 'string'
		? metadata.polvo_code_project_title
		: undefined;
	return buildProjectRootPath(slugifyProjectTitle(title));
}

export function readProjectRootFromProgressPayload(payload: Record<string, unknown> | undefined): string | undefined {
	const root = payload?.project_root;
	return typeof root === 'string' && root.trim() ? normalizeDevRelativePath(root) : undefined;
}

export function readDevSetupFlags(metadata: Record<string, unknown> | undefined): {
	npmInstall: boolean;
	runDev: boolean;
	devCommand: string;
} {
	return {
		npmInstall: metadata?.polvo_code_npm_install === true,
		runDev: metadata?.polvo_code_run_dev === true,
		devCommand: typeof metadata?.polvo_code_dev_command === 'string' && metadata.polvo_code_dev_command.trim()
			? metadata.polvo_code_dev_command.trim()
			: 'npm run dev',
	};
}
