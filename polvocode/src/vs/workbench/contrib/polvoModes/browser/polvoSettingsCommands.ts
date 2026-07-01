/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IOpenPolvoWorkbenchApiService } from './openPolvoWorkbenchApiService.js';

export const POLVO_MANAGE_LLM_PROFILES_COMMAND_ID = 'polvo.settings.llmProfiles';
export const POLVO_CONFIGURE_SMTP_COMMAND_ID = 'polvo.settings.smtp';

const POLVO_SETTINGS_CATEGORY = localize2('polvoSettingsCategory', "OpenPolvo");

async function promptRequired(
	quickInput: IQuickInputService,
	prompt: string,
	options: { password?: boolean; value?: string; placeHolder?: string } = {},
): Promise<string | undefined> {
	const value = await quickInput.input({
		prompt,
		password: options.password,
		value: options.value,
		placeHolder: options.placeHolder,
		ignoreFocusLost: true,
	});
	return value?.trim() ? value.trim() : undefined;
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: POLVO_MANAGE_LLM_PROFILES_COMMAND_ID,
			title: localize2('polvoManageLlmProfiles', "OpenPolvo: Gerir perfis LLM"),
			category: POLVO_SETTINGS_CATEGORY,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const api = accessor.get(IOpenPolvoWorkbenchApiService);
		const quickInput = accessor.get(IQuickInputService);
		const notification = accessor.get(INotificationService);

		let profiles;
		try {
			profiles = await api.listLlmProfiles();
		} catch (err) {
			notification.error(localize('polvoLlmListError', "Não foi possível carregar perfis LLM: {0}", errorText(err)));
			return;
		}

		const createPick = { id: '__create__', label: localize('polvoLlmCreate', "$(add) Novo perfil LLM…") };
		const items = [
			createPick,
			...profiles.map(p => ({
				id: p.id,
				label: p.display_name,
				description: `${p.provider} · ${p.model_id}${p.has_api_key ? '' : localize('polvoLlmNoKey', " · sem chave")}`,
			})),
		];

		const chosen = await quickInput.pick(items, {
			placeHolder: localize('polvoLlmPick', "Selecione um perfil para eliminar ou crie um novo"),
		});
		if (!chosen) {
			return;
		}

		if (chosen.id === '__create__') {
			await this._createProfile(api, quickInput, notification);
			return;
		}

		const confirm = await quickInput.pick(
			[
				{ id: 'yes', label: localize('polvoLlmDeleteYes', "Eliminar \"{0}\"", chosen.label) },
				{ id: 'no', label: localize('polvoLlmDeleteNo', "Cancelar") },
			],
			{ placeHolder: localize('polvoLlmDeleteConfirm', "Eliminar este perfil LLM?") },
		);
		if (confirm?.id === 'yes') {
			try {
				await api.deleteLlmProfile(chosen.id);
				notification.info(localize('polvoLlmDeleted', "Perfil LLM eliminado."));
			} catch (err) {
				notification.error(localize('polvoLlmDeleteError', "Falha ao eliminar perfil: {0}", errorText(err)));
			}
		}
	}

	private async _createProfile(
		api: IOpenPolvoWorkbenchApiService,
		quickInput: IQuickInputService,
		notification: INotificationService,
	): Promise<void> {
		const displayName = await promptRequired(quickInput, localize('polvoLlmName', "Nome do perfil (ex.: GPT-4o pessoal)"));
		if (!displayName) {
			return;
		}
		const providerPick = await quickInput.pick(
			[
				{ id: 'openai', label: 'OpenAI (GPT)' },
				{ id: 'google', label: 'Google Gemini' },
				{ id: 'anthropic', label: 'Anthropic (Claude)' },
			],
			{ placeHolder: localize('polvoLlmProvider', "Provider do modelo") },
		);
		if (!providerPick) {
			return;
		}
		const modelId = await promptRequired(quickInput, localize('polvoLlmModelId', "Model ID (ex.: gpt-4o-mini, gemini-1.5-pro, claude-sonnet-5)"));
		if (!modelId) {
			return;
		}
		const apiKey = await promptRequired(quickInput, localize('polvoLlmApiKey', "API key"), { password: true });
		if (!apiKey) {
			return;
		}
		try {
			await api.createLlmProfile({
				display_name: displayName,
				provider: providerPick.id as 'openai' | 'google' | 'anthropic',
				model_id: modelId,
				api_key: apiKey,
			});
			notification.info(localize('polvoLlmCreated', "Perfil LLM \"{0}\" criado.", displayName));
		} catch (err) {
			notification.error(localize('polvoLlmCreateError', "Falha ao criar perfil: {0}", errorText(err)));
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: POLVO_CONFIGURE_SMTP_COMMAND_ID,
			title: localize2('polvoConfigureSmtp', "OpenPolvo: Configurar SMTP (e-mail)"),
			category: POLVO_SETTINGS_CATEGORY,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const api = accessor.get(IOpenPolvoWorkbenchApiService);
		const quickInput = accessor.get(IQuickInputService);
		const notification = accessor.get(INotificationService);

		let current;
		try {
			current = await api.getSmtpSettings();
		} catch {
			current = undefined;
		}

		const host = await promptRequired(quickInput, localize('polvoSmtpHost', "Servidor SMTP (host)"), { value: current?.host });
		if (!host) {
			return;
		}
		const portRaw = await promptRequired(quickInput, localize('polvoSmtpPort', "Porta SMTP"), { value: String(current?.port ?? 587) });
		if (!portRaw) {
			return;
		}
		const port = Number.parseInt(portRaw, 10);
		if (!Number.isFinite(port) || port <= 0) {
			notification.error(localize('polvoSmtpPortInvalid', "Porta inválida."));
			return;
		}
		const username = await promptRequired(quickInput, localize('polvoSmtpUser', "Utilizador SMTP"), { value: current?.username });
		if (!username) {
			return;
		}
		const password = await quickInput.input({
			prompt: current?.password_set
				? localize('polvoSmtpPasswordKeep', "Password SMTP (deixe vazio para manter a atual)")
				: localize('polvoSmtpPassword', "Password SMTP"),
			password: true,
			ignoreFocusLost: true,
		});
		const fromEmail = await promptRequired(quickInput, localize('polvoSmtpFromEmail', "E-mail de envio (from)"), { value: current?.from_email });
		if (!fromEmail) {
			return;
		}
		const fromName = await promptRequired(quickInput, localize('polvoSmtpFromName', "Nome de envio (from)"), { value: current?.from_name ?? 'OpenPolvo' });
		if (!fromName) {
			return;
		}
		const tlsPick = await quickInput.pick(
			[
				{ id: 'tls', label: localize('polvoSmtpTlsOn', "Usar TLS (recomendado)") },
				{ id: 'plain', label: localize('polvoSmtpTlsOff', "Sem TLS") },
			],
			{ placeHolder: localize('polvoSmtpTls', "Segurança da ligação") },
		);
		if (!tlsPick) {
			return;
		}

		try {
			await api.putSmtpSettings({
				host,
				port,
				username,
				password: password && password.trim() ? password.trim() : undefined,
				from_email: fromEmail,
				from_name: fromName,
				use_tls: tlsPick.id === 'tls',
				email_chat_skip_confirmation: current?.email_chat_skip_confirmation,
			});
			notification.info(localize('polvoSmtpSaved', "Configuração SMTP guardada."));
		} catch (err) {
			notification.error(localize('polvoSmtpSaveError', "Falha ao guardar SMTP: {0}", errorText(err)));
			return;
		}

		const test = await quickInput.pick(
			[
				{ id: 'yes', label: localize('polvoSmtpTestYes', "Testar ligação agora") },
				{ id: 'no', label: localize('polvoSmtpTestNo', "Não testar") },
			],
			{ placeHolder: localize('polvoSmtpTestPrompt', "Testar a configuração SMTP?") },
		);
		if (test?.id === 'yes') {
			try {
				await api.testSmtp();
				notification.info(localize('polvoSmtpTestOk', "Ligação SMTP bem-sucedida."));
			} catch (err) {
				notification.error(localize('polvoSmtpTestError', "Teste SMTP falhou: {0}", errorText(err)));
			}
		}
	}
});

function errorText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
