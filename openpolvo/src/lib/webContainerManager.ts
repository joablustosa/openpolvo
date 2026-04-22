/**
 * Gestor singleton do WebContainer (@webcontainer/api).
 *
 * REGRA CENTRAL: o WebContainer é arrancado UMA SÓ VEZ por sessão de página.
 * O servidor dev persiste mesmo quando o componente React desmonta — ao regressar
 * ao mesmo projecto o URL é restaurado instantaneamente sem re-instalar dependências
 * (padrão Bolt.new / Lovable). Apenas ao mudar de projecto (projectKey diferente)
 * ou ao chamar `destroy()` explicitamente o container é destruído.
 *
 * COOP / COEP (obrigatório):
 *   vite.config.ts → server.headers: { "Cross-Origin-Opener-Policy": "same-origin",
 *                                       "Cross-Origin-Embedder-Policy": "require-corp" }
 *   electron/main.cjs → session.defaultSession.webRequest.onHeadersReceived (para dev)
 *   Produção empacotada (file://) → ver secção de headers abaixo.
 */
import { WebContainer } from "@webcontainer/api";
import type { BuilderFile } from "@/lib/builderMetadata";
import {
  builderFilesToFileSystemTree,
  inferWebContainerSpawnCommands,
  normalizeFsPath,
  readPackageScripts,
} from "@/lib/builderToWebContainerFiles";
import { diffBuilderFiles, patchWebContainerFiles } from "@/lib/webContainerIncrementalPatch";

// ─── Tipos públicos ────────────────────────────────────────────────────────────

export type ContainerPhase =
  | "idle"
  | "booting"
  | "mounting"
  | "installing"
  | "starting"
  | "ready"
  | "error";

export type ManagerCallbacks = {
  onPhaseChange(phase: ContainerPhase): void;
  onLog(chunk: string): void;
  onReady(url: string): void;
  onError(message: string): void;
};

// ─── Estado singleton (persiste entre montagens do componente) ─────────────────

let _wc: WebContainer | null = null;
let _devProc: { kill(): void; exit: Promise<number> } | null = null;
let _previewUrl: string | null = null;
let _projectKey: string | null = null;
let _mountedFiles: BuilderFile[] | null = null;

/** Fila serial: garante que nunca há dois boots simultâneos. */
let _opQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const p = _opQueue.then(task);
  _opQueue = p.then(
    () => undefined,
    () => undefined,
  );
  return p;
}

function tick(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Utilitários de I/O ────────────────────────────────────────────────────────

function pipeStream(
  stream: ReadableStream<string>,
  label: string,
  onLog: (s: string) => void,
): void {
  void stream
    .pipeTo(
      new WritableStream({
        write(chunk) {
          onLog(chunk);
          console.log(`[WC:${label}]`, chunk);
        },
      }),
    )
    .catch(() => {});
}

/**
 * Aguarda `server-ready` ou abertura de porta de preview.
 * Rejeita se o processo terminar antes, ou se exceder `timeoutMs`.
 */
function captureServerUrl(
  wc: WebContainer,
  timeoutMs: number,
  procExit: Promise<number>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const unsubs: Array<() => void> = [];

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const u of unsubs) try { u(); } catch { /* ignore */ }
      fn();
    };

    const timer = setTimeout(() => {
      settle(() =>
        reject(
          new Error(
            `Servidor não ficou pronto em ${Math.round(timeoutMs / 1000)}s.\n\n` +
              "Verificações:\n" +
              "① O script \"dev\" no package.json inclui --host 0.0.0.0\n" +
              "② vite.config.ts tem server: { host: true }\n" +
              "③ Não há erro de compilação no registo acima\n" +
              "④ O projecto tem index.html na raiz (obrigatório para Vite)",
          ),
        ),
      );
    }, timeoutMs);

    unsubs.push(
      wc.on("server-ready", (_port, url) => {
        settle(() => resolve(url));
      }),
    );

    unsubs.push(
      wc.on("port", (port, type, url) => {
        if (type !== "open" || !url || !/^https?:\/\//i.test(url)) return;
        const isPreview =
          (port >= 5173 && port <= 5190) ||
          [3000, 3001, 4173, 4321, 5000, 8000, 8080, 8888].includes(port);
        if (!isPreview) return;
        settle(() => resolve(url));
      }),
    );

    void procExit.then((code) => {
      settle(() =>
        reject(
          new Error(
            `Processo do servidor terminou (código ${code}) antes do preview ficar pronto.\n` +
              "Ver registo acima para detalhes do erro.",
          ),
        ),
      );
    });
  });
}

async function npmInstall(
  wc: WebContainer,
  onLog: (s: string) => void,
): Promise<number> {
  onLog("─── npm install --legacy-peer-deps ───\n");
  const proc = await wc.spawn("npm", ["install", "--legacy-peer-deps"], { output: true });
  pipeStream(proc.output, "npm-install", onLog);
  return proc.exit;
}

async function spawnDev(
  wc: WebContainer,
  cmd: string,
  args: string[],
  env: Record<string, string | number | boolean> | undefined,
  timeoutMs: number,
  onLog: (s: string) => void,
): Promise<{ proc: { kill(): void; exit: Promise<number> }; url: string }> {
  onLog(`\n─── ${cmd} ${args.join(" ")} ───\n`);

  const spawnOpts: { output: boolean; env?: Record<string, string | number | boolean> } = {
    output: true,
  };
  if (env && Object.keys(env).length > 0) spawnOpts.env = env;

  // Criar proxy da promise de saída ANTES do spawn para registar listeners a tempo
  let resolveExit!: (code: number) => void;
  const exitProxy = new Promise<number>((r) => {
    resolveExit = r;
  });

  const proc = await wc.spawn(cmd, args, spawnOpts);
  void proc.exit.then(resolveExit);
  pipeStream(proc.output, "dev-server", onLog);

  const url = await captureServerUrl(wc, timeoutMs, exitProxy);
  return { proc, url };
}

// ─── Classe pública ────────────────────────────────────────────────────────────

/**
 * `WebContainerManager` encapsula o ciclo de vida do WebContainer.
 * Cada instância do componente React cria um manager; ao desmontar chama `detach()`
 * (callbacks desconectados, container vivo). Para destruir de vez, chamar `destroy()`.
 */
export class WebContainerManager {
  private _cb: ManagerCallbacks | null;
  private _detached = false;

  constructor(callbacks: ManagerCallbacks) {
    this._cb = callbacks;
  }

  // ── Emissores ──────────────────────────────────────────────────────────────

  private _phase(p: ContainerPhase): void {
    if (!this._detached) this._cb?.onPhaseChange(p);
  }
  private _log(s: string): void {
    if (!this._detached) this._cb?.onLog(s);
  }
  private _ready(url: string): void {
    if (!this._detached) this._cb?.onReady(url);
  }
  private _err(msg: string): void {
    if (!this._detached) {
      this._cb?.onPhaseChange("error");
      this._cb?.onError(msg);
    }
  }

  // ── API pública ────────────────────────────────────────────────────────────

  /**
   * Restauro instantâneo quando o mesmo projecto já tem servidor activo.
   * Retorna `true` se bem-sucedido — nenhuma operação assíncrona necessária.
   */
  tryFastRestore(projectKey: string, files: BuilderFile[]): boolean {
    if (!_wc || _projectKey !== projectKey || !_previewUrl || !_devProc) return false;

    // Verificar se há mudanças pendentes que precisam de patch
    if (_mountedFiles) {
      const diff = diffBuilderFiles(_mountedFiles, files);
      if (diff.hasChanges) return false;
    }

    this._phase("ready");
    this._ready(_previewUrl);
    return true;
  }

  /**
   * Inicialização completa: boot → mount → npm install → servidor dev.
   * Se o container já está activo com o mesmo projecto, entra no fast-path.
   */
  async init(files: BuilderFile[], projectKey: string): Promise<void> {
    if (this._detached) return;

    const plan = inferWebContainerSpawnCommands(files);
    if (!plan.ok) {
      this._err(plan.reason);
      return;
    }

    return enqueue(async () => {
      if (this._detached) return;

      // ── Verificação COOP / COEP ──────────────────────────────────────────
      if (!window.crossOriginIsolated) {
        this._err(
          "crossOriginIsolated = false — o WebContainer requer isolamento cross-origin.\n\n" +
            "Causas mais comuns:\n\n" +
            "① Desenvolvimento (Vite):\n" +
            "   vite.config.ts → server.headers deve incluir:\n" +
            "   Cross-Origin-Opener-Policy: same-origin\n" +
            "   Cross-Origin-Embedder-Policy: require-corp\n\n" +
            "② Electron em desenvolvimento:\n" +
            "   electron/main.cjs → session.defaultSession.webRequest.onHeadersReceived\n" +
            "   deve injectar os mesmos headers para http://localhost:5173/*\n\n" +
            "③ Electron em produção (file://):\n" +
            "   O protocolo file:// não suporta COOP/COEP. Opções:\n" +
            "   • Usar um servidor HTTP local (express/http-server) e loadURL\n" +
            "   • Registar protocolo custom: protocol.registerSchemesAsPrivileged\n" +
            "     com { secure: true, supportFetchAPI: true, corsEnabled: true }\n\n" +
            "④ Express (backend):\n" +
            "   app.use((_req, res, next) => {\n" +
            '     res.setHeader("Cross-Origin-Opener-Policy", "same-origin");\n' +
            '     res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");\n' +
            "     next();\n" +
            "   });\n\n" +
            "⑤ Nginx:\n" +
            "   add_header Cross-Origin-Opener-Policy same-origin;\n" +
            "   add_header Cross-Origin-Embedder-Policy require-corp;",
        );
        return;
      }

      // ── Destruir container de projecto diferente ──────────────────────────
      if (_wc && _projectKey !== projectKey) {
        await this._hardTeardown();
      }

      // ── Boot único por sessão ──────────────────────────────────────────────
      if (!_wc) {
        this._phase("booting");
        try {
          _wc = await WebContainer.boot({ coep: "require-corp" });
        } catch (e) {
          _wc = null;
          this._err(
            `Falha no boot do WebContainer: ${e instanceof Error ? e.message : String(e)}\n\n` +
              "Se o erro for 'Only a single WebContainer instance can be booted',\n" +
              "faz reload completo da página (Ctrl+R / Cmd+R).",
          );
          return;
        }
        if (this._detached) {
          // O componente desmontou durante o boot — manter container vivo para próxima montagem
          _projectKey = projectKey;
          return;
        }
      }

      const wc = _wc;
      const { startCommand, startArgs, startEnv } = plan;

      // ── Montar ficheiros ───────────────────────────────────────────────────
      this._phase("mounting");
      const tree = builderFilesToFileSystemTree(files);
      try {
        await wc.mount(tree);
      } catch (e) {
        this._err(`Falha ao montar ficheiros: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      _mountedFiles = [...files];
      _projectKey = projectKey;
      if (this._detached) return;

      // ── npm install ────────────────────────────────────────────────────────
      this._phase("installing");
      const code = await npmInstall(wc, this._log.bind(this));
      if (this._detached) return;
      if (code !== 0) {
        this._err(`npm install falhou (código ${code}). Ver registo acima.`);
        return;
      }

      // ── Servidor dev ───────────────────────────────────────────────────────
      this._phase("starting");
      await this._launchServer(wc, startCommand, startArgs, startEnv, files);
    });
  }

  private async _launchServer(
    wc: WebContainer,
    cmd: string,
    args: string[],
    env: Record<string, string | number | boolean> | undefined,
    files: BuilderFile[],
  ): Promise<void> {
    if (this._detached) return;

    try {
      const { proc, url } = await spawnDev(wc, cmd, args, env, 120_000, this._log.bind(this));

      if (this._detached) {
        // Componente desmontado enquanto aguardava o servidor — manter servidor vivo
        _devProc = proc;
        _previewUrl = url;
        return;
      }

      _devProc = proc;
      _previewUrl = url;
      this._phase("ready");
      this._ready(url);

      // Monitorar saída inesperada
      void proc.exit.then((exitCode) => {
        if (_devProc !== proc) return; // já foi substituído por restart/update
        _devProc = null;
        _previewUrl = null;
        if (!this._detached) {
          this._err(
            `O servidor dev terminou inesperadamente (código ${exitCode}).\n` +
              "Usa o botão Reiniciar para reativar o preview.",
          );
        }
      });
    } catch (e) {
      if (this._detached) return;
      // Fallback: build estático + vite preview
      await this._fallback(wc, files);
    }
  }

  private async _fallback(wc: WebContainer, files: BuilderFile[]): Promise<void> {
    this._log("\n─── Fallback: npm run build + vite preview ───\n");
    const scripts = readPackageScripts(files);

    if (scripts.build) {
      const b = await wc.spawn("npm", ["run", "build"], { output: true });
      pipeStream(b.output, "npm-build", this._log.bind(this));
      const bc = await b.exit;
      if (bc !== 0) {
        this._err("npm run build falhou. Ver registo acima.");
        return;
      }
    }

    let resolveExit!: (code: number) => void;
    const exitProxy = new Promise<number>((r) => {
      resolveExit = r;
    });

    const pvProc = scripts.preview
      ? await wc.spawn("npm", ["run", "preview"], { output: true })
      : await wc.spawn("npx", ["vite", "preview", "--host", "0.0.0.0", "--port", "4173"], {
          output: true,
        });

    void pvProc.exit.then(resolveExit);
    pipeStream(pvProc.output, "npm-preview", this._log.bind(this));

    try {
      const url = await captureServerUrl(wc, 90_000, exitProxy);
      if (this._detached) {
        _devProc = pvProc;
        _previewUrl = url;
        return;
      }
      _devProc = pvProc;
      _previewUrl = url;
      this._phase("ready");
      this._ready(url);
    } catch (e) {
      this._err(e instanceof Error ? e.message : "Fallback build/preview falhou.");
    }
  }

  /**
   * Actualiza ficheiros no container em execução.
   * - Só source files alterados → HMR via fs.writeFile (sem reinstalar)
   * - package.json alterado → reinstala dependências e reinicia servidor
   */
  async updateFiles(files: BuilderFile[]): Promise<void> {
    if (this._detached || !_wc || !_mountedFiles) return;

    const diff = diffBuilderFiles(_mountedFiles, files);
    if (!diff.hasChanges) return;

    const plan = inferWebContainerSpawnCommands(files);
    if (!plan.ok) return;

    return enqueue(async () => {
      if (this._detached || !_wc) return;
      const wc = _wc;

      this._phase("mounting");
      try {
        await patchWebContainerFiles(wc, diff);
      } catch (e) {
        this._err(`Falha ao aplicar patch: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      _mountedFiles = [...files];
      if (this._detached) return;

      if (!diff.packageJsonChanged && _previewUrl) {
        // Apenas source files → HMR automático pelo Vite
        this._log(
          `─── HMR: ${diff.toWrite.length} ficheiro(s) actualizado(s) ───\n` +
            diff.toWrite.map((f) => `  • ${normalizeFsPath(f.path)}`).join("\n") +
            "\n",
        );
        this._phase("ready");
        this._ready(_previewUrl);
        return;
      }

      // package.json mudou → reinstalar e reiniciar
      try {
        _devProc?.kill();
      } catch { /* ignore */ }
      _devProc = null;
      _previewUrl = null;

      this._phase("installing");
      const code = await npmInstall(wc, this._log.bind(this));
      if (this._detached) return;
      if (code !== 0) {
        this._err(`npm install falhou após actualização (código ${code}).`);
        return;
      }

      this._phase("starting");
      const { startCommand, startArgs, startEnv } = plan;
      await this._launchServer(wc, startCommand, startArgs, startEnv, files);
    });
  }

  /**
   * Reinicia o servidor dev sem reinstalar dependências.
   */
  async restart(): Promise<void> {
    if (this._detached || !_wc || !_mountedFiles) return;

    const files = _mountedFiles;
    const plan = inferWebContainerSpawnCommands(files);
    if (!plan.ok) return;

    return enqueue(async () => {
      if (this._detached || !_wc) return;

      try {
        _devProc?.kill();
      } catch { /* ignore */ }
      _devProc = null;
      _previewUrl = null;

      this._phase("starting");
      const { startCommand, startArgs, startEnv } = plan;
      await this._launchServer(_wc, startCommand, startArgs, startEnv, files);
    });
  }

  /**
   * Destrói o container e limpa todo o estado global.
   * Chamar apenas ao trocar de projecto ou fechar o painel definitivamente.
   */
  async destroy(): Promise<void> {
    this._detached = true;
    this._cb = null;
    return this._hardTeardown();
  }

  /**
   * Desanexa callbacks sem destruir o container — usar no cleanup do useEffect.
   * O servidor dev continua a correr para restauro rápido na próxima montagem.
   */
  detach(): void {
    this._detached = true;
    this._cb = null;
  }

  private async _hardTeardown(): Promise<void> {
    return enqueue(async () => {
      try {
        _devProc?.kill();
      } catch { /* ignore */ }
      _devProc = null;
      _previewUrl = null;
      _projectKey = null;
      _mountedFiles = null;
      if (_wc) {
        try {
          _wc.teardown();
        } catch { /* ignore */ }
        _wc = null;
      }
      await tick(50);
    });
  }
}

// ─── Helpers de acesso directo (para compatibilidade e uso em repair) ──────────

/** Retorna `true` se o container está activo e o servidor dev está a correr. */
export function isContainerReady(): boolean {
  return _wc !== null && _devProc !== null && _previewUrl !== null;
}

/** URL de preview activo (ou `null` se não há servidor). */
export function getActivePreviewUrl(): string | null {
  return _previewUrl;
}

/** Ficheiros actualmente montados no container. */
export function getMountedFiles(): BuilderFile[] | null {
  return _mountedFiles ? [..._mountedFiles] : null;
}

/** Destrói o container global (usado pelo repair que precisa de estado limpo). */
export async function destroyActiveContainer(): Promise<void> {
  const m = new WebContainerManager({
    onPhaseChange: () => undefined,
    onLog: () => undefined,
    onReady: () => undefined,
    onError: () => undefined,
  });
  await m.destroy();
}
