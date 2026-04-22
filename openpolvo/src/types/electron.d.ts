export {};

declare global {
  interface Window {
    smartagent?: {
      /** Definido no preload quando a UI corre no Electron. */
      isElectron?: boolean;
      platform: NodeJS.Platform;
      /** URL base da API quando definida no processo Electron; senão o renderer deduz (proxy / localhost). */
      apiBaseUrl: string | null;
      /** Desktop: guardar e-mail/senha com cifra do SO (`safeStorage`). */
      credentials?: {
        isEncryptionAvailable: () => Promise<boolean>;
        save: (payload: { email: string; password: string }) => Promise<{
          ok: boolean;
          error?: string;
        }>;
        load: () => Promise<{
          ok: boolean;
          data?: { email: string; password: string } | null;
          error?: string;
        }>;
        clear: () => Promise<{ ok: boolean; error?: string }>;
      };
    };
  }
}
