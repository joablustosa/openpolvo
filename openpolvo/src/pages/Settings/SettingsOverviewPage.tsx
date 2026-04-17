import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Mail, Save, Settings2, Users } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import * as mail from "@/lib/mailApi";

export function SettingsOverviewPage() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [emailChatSkipConfirmation, setEmailChatSkipConfirmation] = useState(false);
  const [smtpConfigured, setSmtpConfigured] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const s = await mail.getSmtpSettings(token);
      setEmailChatSkipConfirmation(Boolean(s.email_chat_skip_confirmation));
      setSmtpConfigured(Boolean(s.host?.trim() && s.password_set));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveChatBehavior = async () => {
    if (!token) return;
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      const s = await mail.getSmtpSettings(token);
      await mail.putSmtpSettings(token, {
        host: (s.host || "").trim(),
        port: s.port || 587,
        username: (s.username || "").trim(),
        from_email: (s.from_email || "").trim(),
        from_name: (s.from_name || "").trim(),
        use_tls: s.use_tls !== false,
        email_chat_skip_confirmation: emailChatSkipConfirmation,
      });
      setOk("Preferência guardada.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao guardar");
    } finally {
      setSaving(false);
    }
  };

  if (!token) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
        <p>Inicie sessão para ver definições.</p>
        <Link to="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Voltar
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-auto bg-background">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <Link to="/" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-2")}>
          <ArrowLeft className="size-4" />
          Chat
        </Link>
        <div className="h-4 w-px bg-border" />
        <Settings2 className="size-4 text-primary" />
        <h1 className="text-sm font-semibold">Definições</h1>
      </header>

      <div className="mx-auto w-full max-w-lg flex-1 space-y-6 p-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> A carregar…
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Atalhos para as áreas de configuração da conta e do agente.
            </p>

            <div className="grid gap-2">
              <Link
                to="/settings/email"
                className={cn(
                  "flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 text-sm transition-colors hover:bg-muted/40",
                )}
              >
                <Mail className="size-4 shrink-0 text-primary" />
                <div className="min-w-0 text-left">
                  <p className="font-medium">Correio (SMTP)</p>
                  <p className="text-xs text-muted-foreground">Servidor, remetente e testes</p>
                </div>
              </Link>
              <Link
                to="/settings/contacts"
                className={cn(
                  "flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 text-sm transition-colors hover:bg-muted/40",
                )}
              >
                <Users className="size-4 shrink-0 text-primary" />
                <div className="min-w-0 text-left">
                  <p className="font-medium">Contactos</p>
                  <p className="text-xs text-muted-foreground">Agenda usada pelo Zé Polvinho nos e-mails</p>
                </div>
              </Link>
            </div>

            <div className="space-y-3 rounded-lg border border-border bg-muted/15 p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Comportamento do chat
              </h2>
              {!smtpConfigured ? (
                <p className="text-xs text-muted-foreground">
                  Configure primeiro o SMTP em Correio para usar envio de e-mail pelo chat.
                </p>
              ) : null}
              <label className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed">
                <input
                  type="checkbox"
                  disabled={!smtpConfigured}
                  className="mt-0.5 size-3.5 shrink-0 rounded border-input disabled:opacity-50"
                  checked={emailChatSkipConfirmation}
                  onChange={(e) => setEmailChatSkipConfirmation(e.target.checked)}
                />
                <span>
                  <span className="font-medium text-foreground">Enviar e-mail directamente pelo chat</span> sem
                  mostrar o passo de confirmação quando o assistente tiver destinatário e texto prontos. Recomendado
                  manter desligado para rever antes de enviar.
                </span>
              </label>
              <Button
                size="sm"
                className="gap-2"
                disabled={saving || !smtpConfigured}
                onClick={() => void saveChatBehavior()}
              >
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                Guardar preferência
              </Button>
            </div>

            {err ? (
              <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{err}</p>
            ) : null}
            {ok ? (
              <p className="rounded-md bg-primary/10 p-2 text-xs text-primary">{ok}</p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
