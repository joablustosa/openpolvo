/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { OpenPolvoLlmProviderId } from './openPolvoWorkbenchApiService.js';

/** Catálogo curado de modelos por fornecedor — evita o utilizador ter de decorar model ids. */
export interface IProviderCatalog {
	readonly id: OpenPolvoLlmProviderId;
	/** Rótulo do fornecedor no seletor (ex.: "OpenAI (GPT)"). */
	readonly label: string;
	/** Codicon do fornecedor. */
	readonly icon: string;
	/** URL onde o utilizador obtém a chave (mostrada no input). */
	readonly keyHelpUrl: string;
	/** Modelos sugeridos; o primeiro é o default ao configurar. */
	readonly models: readonly { readonly id: string; readonly label: string }[];
}

export const PROVIDER_CATALOGS: readonly IProviderCatalog[] = [
	{
		id: 'openai',
		label: 'OpenAI (GPT)',
		icon: 'sparkle',
		keyHelpUrl: 'https://platform.openai.com/api-keys',
		models: [
			{ id: 'gpt-4o', label: 'GPT-4o' },
			{ id: 'gpt-4o-mini', label: 'GPT-4o mini (rápido/barato)' },
			{ id: 'o4-mini', label: 'o4-mini (raciocínio)' },
		],
	},
	{
		id: 'google',
		label: 'Google (Gemini)',
		icon: 'sparkle',
		keyHelpUrl: 'https://aistudio.google.com/app/apikey',
		models: [
			{ id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (rápido)' },
			{ id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
		],
	},
	{
		id: 'anthropic',
		label: 'Anthropic (Claude)',
		icon: 'sparkle',
		keyHelpUrl: 'https://console.anthropic.com/settings/keys',
		models: [
			{ id: 'claude-sonnet-5', label: 'Claude Sonnet 5 (equilíbrio)' },
			{ id: 'claude-opus-4', label: 'Claude Opus 4 (máximo)' },
			{ id: 'claude-haiku-4.5', label: 'Claude Haiku 4.5 (rápido)' },
		],
	},
];

export function providerCatalog(id: string): IProviderCatalog | undefined {
	return PROVIDER_CATALOGS.find(c => c.id === id);
}

/** Nome canónico do perfil "uma chave por fornecedor". */
export function canonicalProfileName(catalog: IProviderCatalog): string {
	return `${catalog.label} · Open Polvo`;
}
