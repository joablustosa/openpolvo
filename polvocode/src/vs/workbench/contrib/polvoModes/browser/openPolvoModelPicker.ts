/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from '../../../../platform/quickinput/common/quickInput.js';
import { IRequestService } from '../../../../platform/request/common/request.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { URI } from '../../../../base/common/uri.js';
import {
	OPENPOLVO_DEFAULT_OLLAMA_URL,
	OpenPolvoLocalLlmModelSettingId,
	OpenPolvoLocalLlmOllamaUrlSettingId,
} from '../common/openpolvoConfiguration.js';
import { canonicalProfileName, PROVIDER_CATALOGS, providerCatalog, type IProviderCatalog } from './openPolvoModelCatalog.js';
import { buildInstallPlan, probeOllama } from './openPolvoLocalLlm.js';
import { IOpenPolvoLlmProfile, IOpenPolvoWorkbenchApiService } from './openPolvoWorkbenchApiService.js';

/** Modelo selecionado — model id enviado ao backend (provider, ollama:<modelo> ou id de perfil). */
export const POLVO_SELECTED_MODEL_STORAGE_KEY = 'openpolvo.chat.selectedModel';
export const POLVO_SELECT_MODEL_COMMAND_ID = 'polvo.model.select';

interface IModelPickItem extends IQuickPickItem {
	readonly kind: 'local' | 'cloud' | 'configure' | 'install';
	readonly modelId?: string;         // id a enviar ao backend
	readonly provider?: string;
	readonly catalogModelId?: string;  // model_id específico (ex.: gpt-4o) para PATCH do perfil
	readonly profileId?: string;
}

function providerConfigured(profiles: readonly IOpenPolvoLlmProfile[], provider: string): IOpenPolvoLlmProfile | undefined {
	return profiles.find(p => p.provider === provider && p.has_api_key);
}

/** Constrói a lista agrupada: IA local detectada + cada fornecedor (configurado ✓ ou 🔒). */
async function buildItems(
	api: IOpenPolvoWorkbenchApiService,
	requestService: IRequestService,
	configurationService: IConfigurationService,
): Promise<(IModelPickItem | IQuickPickSeparator)[]> {
	const items: (IModelPickItem | IQuickPickSeparator)[] = [];

	// --- IA local (Ollama) ---
	const ollamaUrl = (configurationService.getValue<string>(OpenPolvoLocalLlmOllamaUrlSettingId) || '').trim() || OPENPOLVO_DEFAULT_OLLAMA_URL;
	const probe = await probeOllama(requestService, ollamaUrl, CancellationToken.None);
	items.push({ type: 'separator', label: localize('polvoModelLocal', "IA local (Ollama)") });
	if (probe.running && probe.models.length > 0) {
		for (const model of probe.models) {
			items.push({
				kind: 'local',
				label: `$(vm) ${model}`,
				description: localize('polvoModelLocalReady', "local · pronto"),
				modelId: 'ollama',
				provider: 'ollama',
				catalogModelId: model,
			});
		}
	} else {
		items.push({
			kind: 'install',
			label: localize('polvoModelInstallLocal', "$(cloud-download) Instalar / iniciar IA local…"),
			description: probe.running
				? localize('polvoModelNoLocalModel', "sem modelos — baixar um")
				: localize('polvoModelOllamaOff', "Ollama não detectado"),
		});
	}

	// --- Fornecedores cloud ---
	let profiles: IOpenPolvoLlmProfile[] = [];
	try {
		profiles = await api.listLlmProfiles();
	} catch {
		profiles = [];
	}
	for (const catalog of PROVIDER_CATALOGS) {
		const configured = providerConfigured(profiles, catalog.id);
		items.push({ type: 'separator', label: catalog.label });
		if (configured) {
			for (const m of catalog.models) {
				const isActive = configured.model_id === m.id;
				items.push({
					kind: 'cloud',
					label: `$(check) ${m.label}`,
					description: isActive
						? localize('polvoModelActive', "configurado · em uso")
						: localize('polvoModelConfigured', "configurado"),
					modelId: catalog.id,
					provider: catalog.id,
					catalogModelId: m.id,
					profileId: configured.id,
				});
			}
		} else {
			items.push({
				kind: 'configure',
				label: localize('polvoModelConfigureKey', "$(lock) Configurar chave {0}…", catalog.label),
				description: localize('polvoModelNeedsKey', "sem chave — clique para configurar"),
				provider: catalog.id,
			});
		}
	}

	return items;
}

/** Pede a chave do fornecedor e cria/atualiza o perfil canónico (uma chave por fornecedor). */
async function configureProviderKey(
	api: IOpenPolvoWorkbenchApiService,
	quickInput: IQuickInputService,
	notification: INotificationService,
	openerService: IOpenerService,
	catalog: IProviderCatalog,
	existing?: IOpenPolvoLlmProfile,
): Promise<{ provider: string; modelId: string } | undefined> {
	// Escolher o modelo default do fornecedor.
	const modelPick = await quickInput.pick(
		catalog.models.map(m => ({ id: m.id, label: m.label })),
		{ placeHolder: localize('polvoModelPickModel', "Modelo {0} a usar por omissão", catalog.label) },
	);
	if (!modelPick) {
		return undefined;
	}
	const apiKey = await quickInput.input({
		prompt: localize('polvoModelKeyPrompt', "Cole a API key de {0} (guardada localmente e encriptada)", catalog.label),
		placeHolder: catalog.keyHelpUrl,
		password: true,
		ignoreFocusLost: true,
	});
	if (!apiKey?.trim()) {
		// Oferece abrir a página da chave.
		void openerService.open(URI.parse(catalog.keyHelpUrl));
		return undefined;
	}
	try {
		if (existing) {
			await api.updateLlmProfile(existing.id, { model_id: modelPick.id, api_key: apiKey.trim() });
		} else {
			await api.createLlmProfile({
				display_name: canonicalProfileName(catalog),
				provider: catalog.id,
				model_id: modelPick.id,
				api_key: apiKey.trim(),
			});
		}
		notification.info(localize('polvoModelKeySaved', "Chave de {0} guardada. Modelo pronto a usar.", catalog.label));
		return { provider: catalog.id, modelId: catalog.id };
	} catch (err) {
		notification.error(localize('polvoModelKeyError', "Falha ao guardar a chave: {0}", err instanceof Error ? err.message : String(err)));
		return undefined;
	}
}

async function runLocalInstall(
	instantiationService: IInstantiationService,
	configurationService: IConfigurationService,
	notification: INotificationService,
): Promise<void> {
	// Serviços capturados antes de qualquer await (regra code-no-accessor-after-await).
	const model = (configurationService.getValue<string>(OpenPolvoLocalLlmModelSettingId) || '').trim() || 'llama3.2';
	const plan = buildInstallPlan(model);
	try {
		const { ITerminalService } = await import('../../terminal/browser/terminal.js');
		const terminalService = instantiationService.invokeFunction(a => a.get(ITerminalService));
		const instance = await terminalService.createTerminal({ config: { name: plan.windowTitle } });
		terminalService.setActiveInstance(instance);
		await terminalService.focusInstance(instance);
		await instance.sendText(plan.command, true);
	} catch (err) {
		notification.error(
			localize('polvoModelInstallError', "Não foi possível abrir a instalação da IA local: {0}", err instanceof Error ? err.message : String(err)),
		);
	}
}

/**
 * Mostra o seletor de modelos agrupado (local + cloud), com estado configurado/por-configurar
 * e configuração de chave inline. Devolve o model id a enviar ao backend (ou undefined).
 */
export async function showOpenPolvoModelPicker(accessor: ServicesAccessor): Promise<string | undefined> {
	const quickInput = accessor.get(IQuickInputService);
	const api = accessor.get(IOpenPolvoWorkbenchApiService);
	const requestService = accessor.get(IRequestService);
	const configurationService = accessor.get(IConfigurationService);
	const notification = accessor.get(INotificationService);
	const openerService = accessor.get(IOpenerService);
	const storageService = accessor.get(IStorageService);
	const instantiationService = accessor.get(IInstantiationService);

	const items = await buildItems(api, requestService, configurationService);
	const chosen = await quickInput.pick(items, {
		placeHolder: localize('polvoModelPickPlaceholder', "Escolha o modelo de IA (local ou cloud). 🔒 = configurar chave"),
		matchOnDescription: true,
	});
	if (!chosen || !('kind' in chosen)) {
		return undefined;
	}

	if (chosen.kind === 'install') {
		await runLocalInstall(instantiationService, configurationService, notification);
		return undefined;
	}

	if (chosen.kind === 'configure' && chosen.provider) {
		const catalog = providerCatalog(chosen.provider);
		if (!catalog) {
			return undefined;
		}
		const result = await configureProviderKey(api, quickInput, notification, openerService, catalog);
		if (!result) {
			return undefined;
		}
		return persistSelection(storageService, result.modelId);
	}

	// Modelo cloud já configurado: se o utilizador escolheu outro modelo do fornecedor,
	// actualiza o model_id do perfil canónico (sem re-pedir a chave).
	if (chosen.kind === 'cloud' && chosen.profileId && chosen.catalogModelId && chosen.provider) {
		try {
			await api.updateLlmProfile(chosen.profileId, { model_id: chosen.catalogModelId });
		} catch {
			// best-effort — a selecção do fornecedor continua válida
		}
		return persistSelection(storageService, chosen.modelId ?? chosen.provider);
	}

	if (chosen.kind === 'local') {
		return persistSelection(storageService, 'ollama');
	}

	return chosen.modelId ? persistSelection(storageService, chosen.modelId) : undefined;
}

function persistSelection(storageService: IStorageService, modelId: string): string {
	storageService.store(POLVO_SELECTED_MODEL_STORAGE_KEY, modelId, StorageScope.PROFILE, StorageTarget.USER);
	return modelId;
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: POLVO_SELECT_MODEL_COMMAND_ID,
			title: localize2('polvoSelectModel', "OpenPolvo: Escolher modelo de IA"),
			category: localize2('polvoSettingsCategory', "OpenPolvo"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await showOpenPolvoModelPicker(accessor);
	}
});
