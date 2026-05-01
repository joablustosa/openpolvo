/** Origem do backend Go (sem barra final). Alinhar com `HTTP_ADDR` no `.env` do backend (ex.: `:8081`). */
export const DEFAULT_API_ORIGIN = "http://127.0.0.1:8081";

function stripTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, "");
}

/**
 * Base URL da API (sem barra final).
 * - Electron empacotado: `smartagent.apiBaseUrlOverride` vem do processo principal (alinha com `backend.env`).
 * - Dev + Vite (`http://localhost:5174`): URL vazia → pedidos relativos passam pelo proxy em `vite.config.ts`
 *   (evita falhas entre origens com COEP/CORS ao contactar `127.0.0.1:8081` directamente).
 * - `VITE_API_BASE_URL` no `.env` do Vite (build/preview ou browser sem proxy).
 * - Por defeito: {@link DEFAULT_API_ORIGIN}.
 */
export function apiBaseUrl(): string {
  const bridge = typeof window !== "undefined" ? window.smartagent?.apiBaseUrlOverride : undefined;
  if (typeof bridge === "string" && bridge.trim() !== "") {
    return stripTrailingSlashes(bridge.trim());
  }

  if (import.meta.env.DEV && typeof window !== "undefined") {
    try {
      const { protocol, hostname } = window.location;
      if (protocol === "http:" && (hostname === "localhost" || hostname === "127.0.0.1")) {
        return "";
      }
    } catch {
      /* ignore */
    }
  }

  const viteRaw = import.meta.env.VITE_API_BASE_URL;
  if (typeof viteRaw === "string" && viteRaw.trim() !== "") {
    return stripTrailingSlashes(viteRaw.trim());
  }

  return DEFAULT_API_ORIGIN;
}

/** Para mensagens ao utilizador quando `apiBaseUrl()` está vazio (proxy Vite em dev). */
export function apiBaseUrlForDisplay(): string {
  const u = apiBaseUrl();
  if (u !== "") return u;
  const baked =
    typeof import.meta.env.VITE_API_BASE_URL === "string" &&
    import.meta.env.VITE_API_BASE_URL.trim() !== ""
      ? stripTrailingSlashes(import.meta.env.VITE_API_BASE_URL.trim())
      : DEFAULT_API_ORIGIN;
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin} (proxy → ${baked})`;
  }
  return baked;
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

function redirectToLogin(): void {
  try {
    const w = typeof window !== "undefined" ? window : null;
    if (!w) return;
    const bridge = (w as any).smartagent;
    // No Electron usamos HashRouter, então "/login" em file:// quebra.
    if (bridge?.isElectron) {
      if (!w.location.hash || !w.location.hash.startsWith("#/login")) {
        w.location.hash = "#/login";
      }
      return;
    }
    w.location.href = "/login";
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
      redirectToLogin();
    }
  }
  return res;
}
