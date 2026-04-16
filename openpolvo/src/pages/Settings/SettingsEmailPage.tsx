import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Mail, Save } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import * as mail from "@/lib/mailApi";

export function SettingsEmailPage() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [useTLS, setUseTLS] = useState(true);
  const [hadPassword, setHadPassword] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const s = await mail.getSmtpSettings(token);
      setHost(s.host || "");
      setPort(String(s.port || 587));
      setUsername(s.username || "");
      setFromEmail(s.from_email || "");
      setFromName(s.from_name || "");
      setUseTLS(s.use_tls !== false);
      setHadPassword(s.password_set);
      setPassword("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!token) return;
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      await mail.putSmtpSettings(token, {
        host: host.trim(),
        port: parseInt(port, 10) || 587,
        username: username.trim(),
        password: password.trim() || undefined,
        from_email: fromEmail.trim(),
        from_name: fromName.trim(),
        use_tls: useTLS,
      });
      setOk("Configuração guardada.");
      setPassword("");
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
        <p>Inicie sessão para configurar o SMTP.</p>
        <Link to="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Voltar
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-auto bg-background">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <Link
          to="/"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-2")}
        >
          <ArrowLeft className="size-4" />
          Chat
        </Link>
        <div className="h-4 w-px bg-border" />
        <Mail className="size-4 text-primary" />
        <h1 className="text-sm font-semibold">Correio (SMTP)</h1>
        <span className="text-xs text-muted-foreground">
          Envios usam esta conta · o agente vê o remetente no chat
        </span>
      </header>

      <div className="mx-auto w-full max-w-lg flex-1 space-y-4 p-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> A carregar…
          </div>
        ) : (
          <>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Os dados ficam na sua conta (password encriptada no servidor). O Zé Polvinho
              usa o remetente e servidor abaixo quando fala de e-mails; o envio real faz-se
              pela API com o seu JWT ou a partir desta página (extensão futura no chat).
            </p>
            <div className="space-y-1">
              <label className="text-[10px] font-medium uppercase text-muted-foreground">
                Servidor SMTP
              </label>
              <Input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="smtp.exemplo.com"
                className="h-9 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-medium uppercase text-muted-foreground">
                  Porta
                </label>
                <Input
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  className="h-9 font-mono text-sm"
                />
              </div>
              <label className="flex cursor-pointer items-end gap-2 pb-1 text-xs">
                <input
                  type="checkbox"
                  className="size-3.5 rounded border-input"
                  checked={useTLS}
                  onChange={(e) => setUseTLS(e.target.checked)}
                />
                STARTTLS / TLS
              </label>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium uppercase text-muted-foreground">
                Utilizador SMTP
              </label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium uppercase text-muted-foreground">
                Password SMTP
                {hadPassword ? (
                  <span className="ml-1 font-normal normal-case text-muted-foreground">
                    (deixe vazio para manter)
                  </span>
                ) : null}
              </label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium uppercase text-muted-foreground">
                E-mail remetente (From)
              </label>
              <Input
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                placeholder="eu@dominio.com"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium uppercase text-muted-foreground">
                Nome a mostrar
              </label>
              <Input
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <Button
              className="gap-2"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Guardar
            </Button>
            {err ? (
              <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                {err}
              </p>
            ) : null}
            {ok ? (
              <p className="rounded-md bg-primary/10 p-2 text-xs text-primary">{ok}</p>
            ) : null}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Testar envio (opcional)</summary>
              <TestSendBlock token={token} />
            </details>
          </>
        )}
      </div>
    </div>
  );
}

function TestSendBlock({ token }: { token: string }) {
  const [to, setTo] = useState("");
  const [sub, setSub] = useState("Teste Open Polvo");
  const [body, setBody] = useState("Mensagem de teste.");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="mt-2 space-y-2 rounded-md border border-border bg-muted/20 p-2">
      <Input
        placeholder="Para (e-mail)"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        className="h-8 text-xs"
      />
      <Input
        placeholder="Assunto"
        value={sub}
        onChange={(e) => setSub(e.target.value)}
        className="h-8 text-xs"
      />
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="min-h-[60px] text-xs"
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={busy || !to.trim()}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            await mail.sendEmail(token, {
              to: to.trim(),
              subject: sub.trim(),
              body,
            });
            setMsg("Enviado.");
          } catch (e) {
            setMsg(e instanceof Error ? e.message : "Erro");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : "Enviar teste"}
      </Button>
      {msg ? <p className="text-[11px]">{msg}</p> : null}
    </div>
  );
}
