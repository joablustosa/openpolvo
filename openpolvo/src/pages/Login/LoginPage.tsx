import { FormEvent, useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { apiBaseUrlForDisplay, apiUrl } from "@/lib/api";
import { desktopClipboard, desktopLogs, desktopServices } from "@/lib/desktopApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AppLogo } from "@/components/brand/AppLogo";
import { PasswordFieldWithToggle } from "@/components/auth/PasswordFieldWithToggle";
import {
  clearSavedCredentials,
  isCredentialStorageAvailable,
  isElectronShell,
  loadSavedCredentials,
  saveCredentialsToDisk,
} from "@/lib/electronCredentials";

export function LoginPage() {
  const { token, setSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rememberDesktop, setRememberDesktop] = useState(false);
  const [canStoreCreds, setCanStoreCreds] = useState(false);

  useEffect(() => {
    const st = location.state as
      | { prefillEmail?: string; prefillPassword?: string }
      | null
      | undefined;
    if (st?.prefillEmail) setEmail(st.prefillEmail);
    if (st?.prefillPassword) setPassword(st.prefillPassword);
  }, [location.state]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!isElectronShell()) return;
      const ok = await isCredentialStorageAvailable();
      if (cancelled) return;
      setCanStoreCreds(ok);
      if (!ok) return;
      const saved = await loadSavedCredentials();
      if (cancelled || !saved) return;
      setEmail(saved.email);
      setPassword(saved.password);
      setRememberDesktop(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (token) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/v1/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        error?: string;
      };
      if (!res.ok) {
        if (isElectronShell()) {
          void desktopLogs.append(
            "login",
            `login failed status=${res.status} email=${email.trim()} error=${data.error ?? "(none)"}`,
          );
        }
        // Em desktop, um erro genérico sem contexto é impossível de debugar.
        // Anexa diagnóstico dos serviços (API/Python) quando disponível.
        try {
          if (isElectronShell()) {
            const d = await desktopServices.getDiagnostics();
            const apiLines = d.api.logs
              .slice(-12)
              .map((l) => (l.isError ? `stderr: ${l.line}` : `stdout: ${l.line}`))
              .join("\n");
            setError(
              (data.error ?? "Não foi possível entrar.") +
                `\n\nDiagnóstico:\n- API: ${d.api.status}\n- Intelligence: ${d.intelligence.status}` +
                (apiLines ? `\n\nÚltimos logs da API:\n${apiLines}` : ""),
            );
          } else {
            setError(data.error ?? "Não foi possível entrar.");
          }
        } catch {
          setError(data.error ?? "Não foi possível entrar.");
        }
        return;
      }
      if (!data.access_token) {
        setError("Resposta inválida do servidor.");
        return;
      }
      setSession(data.access_token);

      if (isElectronShell() && canStoreCreds) {
        if (rememberDesktop) {
          const r = await saveCredentialsToDisk({ email, password });
          if (!r.ok) {
            console.warn("[Open Polvo] Não foi possível guardar credenciais:", r.error);
          }
        } else {
          await clearSavedCredentials();
        }
      }

      navigate("/", { replace: true });
    } catch (e) {
      if (isElectronShell()) {
        void desktopLogs.append("login", `login exception: ${String((e as any)?.message ?? e)}`);
      }
      try {
        if (isElectronShell()) {
          const d = await desktopServices.getDiagnostics();
          setError(
            `Não foi possível contactar o servidor (API: ${apiBaseUrlForDisplay()}).\n\n` +
              `Diagnóstico:\n- API: ${d.api.status}\n- Intelligence: ${d.intelligence.status}\n\n` +
              `Tente: reiniciar serviços na bandeja do sistema.`,
          );
        } else {
          setError(
            `Não foi possível contactar o servidor (API: ${apiBaseUrlForDisplay()}). Confirme que o backend Go está a correr ou ajuste VITE_API_BASE_URL.`,
          );
        }
      } catch {
        setError(
          `Não foi possível contactar o servidor (API: ${apiBaseUrlForDisplay()}). Confirme que o backend Go está a correr ou ajuste VITE_API_BASE_URL.`,
        );
      }
    } finally {
      setLoading(false);
    }
  }

  const showRememberOption = isElectronShell();

  async function copyDiagnostics() {
    try {
      const paths = await desktopLogs.getPaths();
      const tail = await desktopLogs.readTail(256_000);
      const text =
        `Open Polvo — diagnóstico (login)\n` +
        `Gerado em: ${new Date().toISOString()}\n` +
        `API base: ${apiBaseUrlForDisplay()}\n` +
        `Log file: ${paths.ok ? paths.file : "(indisponível)"}\n\n` +
        `--- log tail ---\n` +
        (tail.ok ? tail.text : `Erro ao ler logs: ${tail.error}`);
      await desktopClipboard.writeText(text);
      setError((prev) => (prev ? `${prev}\n\n(Copiado diagnóstico para a área de transferência.)` : "Copiado diagnóstico para a área de transferência."));
    } catch (e) {
      setError(`Falha ao copiar diagnóstico.\n\n${String((e as any)?.message ?? e)}`);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-md border-border/80 shadow-xl">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-2 flex size-14 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
            <AppLogo className="size-11 rounded-lg" />
          </div>
          <CardTitle className="text-xl">Open Polvo</CardTitle>
          <CardDescription>
            Entre com a sua conta para aceder à área de trabalho.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            {error ? (
              <p className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm text-muted-foreground">
                E-mail
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="voce@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>
            <PasswordFieldWithToggle
              id="password"
              label="Senha"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              disabled={loading}
            />
            {showRememberOption ? (
              <div className="space-y-1">
                <label className="flex cursor-pointer items-start gap-2 text-sm leading-snug text-muted-foreground">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 rounded border-border accent-primary"
                    checked={rememberDesktop}
                    disabled={loading || !canStoreCreds}
                    onChange={(e) => setRememberDesktop(e.target.checked)}
                  />
                  <span>
                    Guardar utilizador e senha neste computador
                    {!canStoreCreds ? (
                      <span className="mt-1 block text-xs text-amber-600 dark:text-amber-500">
                        Neste sistema a cifra do SO não está disponível; as credenciais não
                        serão guardadas.
                      </span>
                    ) : null}
                  </span>
                </label>
              </div>
            ) : null}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "A entrar…" : "Entrar"}
            </Button>

            {isElectronShell() ? (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                  onClick={() => void desktopLogs.openFolder()}
                >
                  Abrir pasta de logs
                </button>
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                  onClick={() => void desktopLogs.revealFile()}
                >
                  Mostrar arquivo de log
                </button>
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                  onClick={() => void copyDiagnostics()}
                >
                  Copiar diagnóstico
                </button>
              </div>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
