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

function clearAuthSession(): void {
  try {
    localStorage.removeItem("smartagent_auth_token");
    localStorage.removeItem("smartagent_target_url");
  } catch {
    // ignore
  }
}

export async function fetchApi(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(apiUrl(path), init);
  if (res.status === 401) {
    clearAuthSession();
    if (typeof window !== "undefined") {
      const cur = window.location.pathname + window.location.search + window.location.hash;
      try {
        if (cur && cur !== "/login") localStorage.setItem("smartagent_target_url", cur);
      } catch {
        // ignore
      }
      window.location.href = "/login";
    }
  }
  return res;
}
