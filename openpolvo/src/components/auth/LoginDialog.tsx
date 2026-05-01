import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { apiBaseUrlForDisplay, apiUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppLogo } from "@/components/brand/AppLogo";
import { PasswordFieldWithToggle } from "@/components/auth/PasswordFieldWithToggle";
import {
  clearSavedCredentials,
  isCredentialStorageAvailable,
  isElectronShell,
  loadSavedCredentials,
  saveCredentialsToDisk,
} from "@/lib/electronCredentials";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function LoginDialog({ open, onOpenChange }: Props) {
  const { setSession } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rememberDesktop, setRememberDesktop] = useState(false);
  const [canStoreCreds, setCanStoreCreds] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      if (!isElectronShell()) {
        setCanStoreCreds(false);
        return;
      }
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
  }, [open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/v1/auth/login"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
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

      onOpenChange(false);
      setEmail("");
      setPassword("");
      setRememberDesktop(false);
    } catch {
      setError(
        `Não foi possível contactar o servidor (API: ${apiBaseUrlForDisplay()}). Confirme que o backend Go está a correr ou ajuste VITE_API_BASE_URL.`,
      );
    } finally {
      setLoading(false);
    }
  }

  const showRememberOption = isElectronShell();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" showCloseButton>
        <DialogHeader>
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-lg bg-muted/60 ring-1 ring-border/60">
            <AppLogo className="size-9 rounded-md" />
          </div>
          <DialogTitle className="text-center">Entrar — Zé Polvinho</DialogTitle>
          <DialogDescription className="text-center">
            Para continuar a conversar após as perguntas de visitante, inicie sessão
            com a sua conta.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          {error ? (
            <p className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="space-y-2">
            <label htmlFor="login-dialog-email" className="text-sm text-muted-foreground">
              E-mail
            </label>
            <Input
              id="login-dialog-email"
              type="email"
              autoComplete="username"
              placeholder="voce@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
          </div>
          <PasswordFieldWithToggle
            id="login-dialog-password"
            label="Senha"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            disabled={loading}
          />
          {showRememberOption ? (
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
                    Neste sistema a cifra do SO não está disponível.
                  </span>
                ) : null}
              </span>
            </label>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Agora não
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "A entrar…" : "Entrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
