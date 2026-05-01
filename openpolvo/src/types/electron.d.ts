export {};

declare global {
  interface Window {
    smartagent?: {
      /** Definido no preload quando a UI corre no Electron. */
      isElectron?: boolean;
      /** Empacotado: origem da API injectada pelo main (ex.: userData/backend.env); dev: null. */
      apiBaseUrlOverride?: string | null;
      platform: NodeJS.Platform;
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
      app?: {
        getAutoLaunch: () => Promise<boolean>;
        setAutoLaunch: (enabled: boolean) => Promise<boolean>;
        show: () => Promise<void>;
        hide: () => Promise<void>;
        quit: () => Promise<void>;
        checkForUpdates: () => Promise<{ ok: boolean; error?: string }>;
      };
      logs?: {
        getPaths: () => Promise<{ ok: boolean; dir?: string; file?: string; error?: string }>;
        readTail: (maxBytes: number) => Promise<{ ok: boolean; text?: string; error?: string }>;
        append: (payload: { scope: string; message: string }) => Promise<{ ok: boolean; error?: string }>;
        openFolder: () => Promise<{ ok: boolean; dir?: string; error?: string }>;
        revealFile: () => Promise<{ ok: boolean; file?: string; error?: string }>;
      };
      clipboard?: {
        writeText: (payload: { text: string }) => Promise<{ ok: boolean; error?: string }>;
      };
      polvoCode?: {
        writeProject: (payload: {
          title: string;
          files: { path: string; content: string }[];
        }) => Promise<{ ok: boolean; workspacePath?: string; error?: string }>;
        chooseProjectFolder: () => Promise<
          { ok: boolean; workspacePath?: string; canceled?: boolean; error?: string }
        >;
        npmInstall: (workspacePath: string) => Promise<{ ok: boolean; error?: string; code?: number | null }>;
        devStart: (opts: {
          workspacePath: string;
          port?: number;
          openBrowser?: boolean;
        }) => Promise<{ ok: boolean; error?: string }>;
        devStop: () => Promise<{ ok: boolean; error?: string }>;
        openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
        revealInExplorer: (projectPath: string) => Promise<{ ok: boolean; error?: string }>;
        tryOpenExternalEditor: (
          workspacePath: string,
        ) => Promise<{ ok: boolean; error?: string; command?: string }>;
        listDir: (payload: {
          workspacePath: string;
          relPath?: string;
        }) => Promise<
          | {
              ok: true;
              entries: { name: string; relPath: string; isDirectory: boolean }[];
            }
          | { ok: false; error?: string }
        >;
        readFile: (payload: {
          workspacePath: string;
          relPath: string;
        }) => Promise<{ ok: true; content: string } | { ok: false; error?: string }>;
        writeFile: (payload: {
          workspacePath: string;
          relPath: string;
          content: string;
          createDirs?: boolean;
        }) => Promise<{ ok: boolean; error?: string }>;
        onEvent: (callback: (payload: Record<string, unknown>) => void) => () => void;
      };
    };
  }
}
