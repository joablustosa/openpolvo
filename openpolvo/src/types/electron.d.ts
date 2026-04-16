export {};

declare global {
  interface Window {
    smartagent?: {
      /** Definido no preload quando a UI corre no Electron. */
      isElectron?: boolean;
      platform: NodeJS.Platform;
      /** URL base da API quando definida no processo Electron; senão o renderer deduz (proxy / localhost). */
      apiBaseUrl: string | null;
    };
  }
}
