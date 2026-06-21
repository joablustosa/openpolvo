/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** Página de releases ou ficheiro .exe/.msi da versão desktop (plugins no painel). */
  readonly VITE_DESKTOP_DOWNLOAD_URL?: string;
  /** Desk MVP v0.1 — shell Agent/Code/Flow em vez do layout chat+SitePanel legacy. */
  readonly VITE_DESK_MVP_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
