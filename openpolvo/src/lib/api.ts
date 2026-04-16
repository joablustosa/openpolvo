/** Origem do backend Go (sem barra final). Alinhar com `HTTP_ADDR` na raiz (ex.: `:8080` → 127.0.0.1:8080). */
export const DEFAULT_API_ORIGIN = "http://127.0.0.1:8080";

function stripTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, "");
}

/**
 * Base URL da API (sem barra final).
 * - `VITE_API_BASE_URL` no `.env` do Vite sobrepõe tudo (outro host/porta).
 * - `smartagent.apiBaseUrl` (Electron + OPEN_LA_ELE_API_URL) sobrepõe exceto quando VITE está definido.
 * - Por defeito: {@link DEFAULT_API_ORIGIN} (browser, Electron dev e build estático).
 */
export function apiBaseUrl(): string {
  const viteRaw = import.meta.env.VITE_API_BASE_URL;
  if (typeof viteRaw === "string" && viteRaw.trim() !== "") {
    return stripTrailingSlashes(viteRaw.trim());
  }

  if (typeof window !== "undefined") {
    const bridge = window.smartagent;
    if (
      bridge &&
      typeof bridge.apiBaseUrl === "string" &&
      bridge.apiBaseUrl.trim() !== ""
    ) {
      return stripTrailingSlashes(bridge.apiBaseUrl.trim());
    }
  }

  return DEFAULT_API_ORIGIN;
}

export function apiUrl(path: string): string {
  const base = apiBaseUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
