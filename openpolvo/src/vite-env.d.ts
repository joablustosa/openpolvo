/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** Página de releases ou ficheiro .exe/.msi da versão desktop (plugins no painel). */
  readonly VITE_DESKTOP_DOWNLOAD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
