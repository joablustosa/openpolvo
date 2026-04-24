import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Cpu, Loader2, Mail, Monitor, Power, Save, Settings2, Share2, Users, Zap } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import * as finance from "@/lib/financeApi";
import * as mail from "@/lib/mailApi";
import { isElectron, serviceStatusColor, serviceStatusLabel } from "@/lib/desktopApi";
import { useDesktopServices } from "@/hooks/useDesktopServices";

export function SettingsOverviewPage() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const { status: svcStatus, autoLaunch, toggleAutoLaunch } = useDesktopServices();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [emailChatSkipConfirmation, setEmailChatSkipConfirmation] = useState(false);
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [digestTz, setDigestTz] = useState("Europe/Lisbon");
  const [digestHour, setDigestHour] = useState(8);
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [digestIncFin, setDigestIncFin] = useState(true);
  const [digestIncTasks, setDigestIncTasks] = useState(true);
  const [digestLast, setDigestLast] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const s = await mail.getSmtpSettings(token);
      setEmailChatSkipConfirmation(Boolean(s.email_chat_skip_confirmation));
      setSmtpConfigured(Boolean(s.host?.trim() && s.password_set));
      const d = await finance.getDigestSettings(token);
      setDigestTz(d.timezone || "Europe/Lisbon");
      setDigestHour(d.digest_hour ?? 8);
      setDigestEnabled(Boolean(d.digest_enabled));
      setDigestIncFin(d.include_finance_summary !== false);
      setDigestIncTasks(d.include_tasks !== false);
      setDigestLast(d.last_digest_sent_on ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveDigest = async () => {
    if (!token) return;
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      await finance.putDigestSettings(token, {
        timezone: digestTz.trim() || "Europe/Lisbon",
        digest_hour: digestHour,
        digest_enabled: digestEnabled,
        include_finance_summary: digestIncFin,
        include_tasks: digestIncTasks,
      });
      setOk("Definições do digest guardadas.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao guardar digest");
    } finally {
      setSaving(false);
    }
  };

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
                to="/settings/plugins"
                className={cn(
                  "flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-3 py-3 text-sm transition-colors hover:bg-primary/10",
                )}
              >
                <Zap className="size-4 shrink-0 text-primary" />
                <div className="min-w-0 text-left">
                  <p className="font-medium">Integrações</p>
                  <p className="text-xs text-muted-foreground">E-mail, WhatsApp, Facebook e Instagram — tudo num só lugar</p>
                </div>
              </Link>
              <Link
                to="/settings/llm"
                className={cn(
                  "flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 text-sm transition-colors hover:bg-muted/40",
                )}
              >
                <Cpu className="size-4 shrink-0 text-primary" />
                <div className="min-w-0 text-left">
                  <p className="font-medium">Modelos LLM</p>
                  <p className="text-xs text-muted-foreground">
                    Perfis OpenAI / Gemini com chaves locais (SQLite) para o agente
                  </p>
                </div>
              </Link>
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
                to="/settings/meta"
                className={cn(
                  "flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 text-sm transition-colors hover:bg-muted/40",
                )}
              >
                <Share2 className="size-4 shrink-0 text-primary" />
                <div className="min-w-0 text-left">
                  <p className="font-medium">Meta (WhatsApp, Facebook, Instagram)</p>
                  <p className="text-xs text-muted-foreground">Publicar e responder nas redes sociais Meta</p>
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

            {/* ── Secção App & Serviços (apenas no Electron) ───────────────────── */}
            {isElectron() ? (
              <div className="space-y-3 rounded-lg border border-border bg-muted/15 p-4">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                  <Monitor className="size-3.5" />
                  App &amp; Serviços
                </h2>
                <p className="text-xs text-muted-foreground">
                  Quando a janela é fechada, o Open Polvo permanece na bandeja do sistema e os
                  serviços continuam em execução — as automações agendadas disparam normalmente.
                </p>

                {/* Estado dos serviços */}
                <div className="grid gap-1.5">
                  {(
                    [
                      { key: "api", label: "API Go (scheduler)" },
                      { key: "intelligence", label: "Python Intelligence" },
                    ] as const
                  ).map(({ key, label }) => {
                    const s = svcStatus[key];
                    return (
                      <div key={key} className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-xs">
                        <span className="text-muted-foreground">{label}</span>
                        <span className={cn("flex items-center gap-1.5 font-medium", serviceStatusColor(s))}>
                          {s === "running" || s === "external" ? (
                            <CheckCircle2 className="size-3" />
                          ) : s === "starting" || s === "restarting" ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <span className="size-3 rounded-full border border-current" />
                          )}
                          {serviceStatusLabel(s)}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Auto-launch toggle */}
                <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-3.5 shrink-0 rounded border-input"
                    checked={autoLaunch}
                    onChange={() => void toggleAutoLaunch()}
                  />
                  <span>
                    <span className="font-medium text-foreground">
                      {typeof window !== "undefined" && (window as any).smartagent?.platform === "darwin"
                        ? "Iniciar ao arrancar o Mac"
                        : "Iniciar com o Windows"}
                    </span>
                    <span className="block text-muted-foreground">
                      A app abre na bandeja sem mostrar a janela. As automações começam a disparar
                      logo após o início de sessão no sistema.
                    </span>
                  </span>
                </label>

                {/* Sair completamente */}
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-[11px] text-destructive hover:text-destructive"
                    onClick={() => void (window as any).smartagent?.app?.quit()}
                  >
                    <Power className="size-3" />
                    Encerrar completamente
                  </Button>
                  <span className="text-[10px] text-muted-foreground">
                    Para os serviços e fecha a app
                  </span>
                </div>
              </div>
            ) : null}

            <div className="space-y-3 rounded-lg border border-border bg-muted/15 p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Digest diário (agenda e finanças)
              </h2>
              <p className="text-xs text-muted-foreground">
                O envio usa o teu SMTP e corre no servidor da API quando{" "}
                <code className="rounded bg-muted px-1">DIGEST_SCHEDULER_ENABLED=true</code> está definido.
                {!smtpConfigured ? (
                  <>
                    {" "}
                    <Link to="/settings/email" className="text-primary underline">
                      Configura o SMTP
                    </Link>{" "}
                    para o digest poder ser enviado.
                  </>
                ) : null}
              </p>
              {digestLast ? (
                <p className="text-[11px] text-muted-foreground">Último digest enviado: {digestLast}</p>
              ) : null}
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="size-3.5 rounded border-input"
                  checked={digestEnabled}
                  onChange={(e) => setDigestEnabled(e.target.checked)}
                />
                <span>Activar digest diário</span>
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">Fuso horário (IANA)</span>
                  <Input
                    className="h-8 text-xs"
                    value={digestTz}
                    onChange={(e) => setDigestTz(e.target.value)}
                    placeholder="Europe/Lisbon"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">Hora local (0–23)</span>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    className="h-8 text-xs"
                    value={digestHour}
                    onChange={(e) => setDigestHour(Number(e.target.value))}
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="size-3.5 rounded border-input"
                  checked={digestIncFin}
                  onChange={(e) => setDigestIncFin(e.target.checked)}
                />
                <span>Incluir resumo de finanças</span>
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="size-3.5 rounded border-input"
                  checked={digestIncTasks}
                  onChange={(e) => setDigestIncTasks(e.target.checked)}
                />
                <span>Incluir tarefas com prazo</span>
              </label>
              <Button size="sm" className="gap-2" disabled={saving} onClick={() => void saveDigest()}>
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                Guardar digest
              </Button>
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
