/**
 * Aplicativos embutidos no painel (Electron). Cada id mapeia para um URL público
 * ou de pré-produção acordado com o integrador; o webview usa a mesma partição
 * para manter sessões de login entre arranques.
 */
/** SmartBus — pré-produção (login embutido no webview). */
export const SMARTBUS_URL =
  "https://preprod-guanabara-backoffice-smartbus.smarttravelit.com/#/login" as const;

export type AppId =
  | "whatsapp"
  | "instagram"
  | "facebook"
  | "gmail"
  | "smartbus"
  | "gbtech"
  | "clickbus"
  | "buscaonibus";

/** Ordem no menu Plugins e nos submenus. */
export const PLUGIN_IDS: readonly AppId[] = [
  "whatsapp",
  "instagram",
  "facebook",
  "gmail",
  "smartbus",
  "gbtech",
  "clickbus",
  "buscaonibus",
] as const;

export const APP_LABELS: Record<AppId, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  gmail: "Gmail",
  smartbus: "SmartBus",
  gbtech: "Portal GbTech",
  clickbus: "Clickbus",
  buscaonibus: "Busca Ônibus",
};

/** URLs alinhadas com internal/agents/zepolvinho/native_plugins.go */
export const PLUGIN_URLS: Record<AppId, string> = {
  whatsapp: "https://web.whatsapp.com/",
  instagram: "https://www.instagram.com/",
  facebook: "https://www.facebook.com/",
  gmail: "https://mail.google.com/",
  smartbus: SMARTBUS_URL,
  gbtech: "https://dev-portal.gbtech.guanabaraholding.com.br/#/",
  clickbus: "https://www.clickbus.com.br/",
  buscaonibus: "https://www.buscaonibus.com.br/",
};

export function getPluginUrl(id: AppId): string {
  return PLUGIN_URLS[id];
}

export function isAppId(s: string): s is AppId {
  return (PLUGIN_IDS as readonly string[]).includes(s);
}
