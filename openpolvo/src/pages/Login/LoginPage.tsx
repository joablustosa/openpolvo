import { FormEvent, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { apiBaseUrl, apiUrl } from "@/lib/api";
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rememberDesktop, setRememberDesktop] = useState(false);
  const [canStoreCreds, setCanStoreCreds] = useState(false);

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
        setError(data.error ?? "Não foi possível entrar.");
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
    } catch {
      setError(
        `Não foi possível contactar o servidor (API: ${apiBaseUrl()}). Confirme que o backend está a correr em :8080 ou ajuste VITE_API_BASE_URL.`,
      );
    } finally {
      setLoading(false);
    }
  }

  const showRememberOption = isElectronShell();

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
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
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
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
