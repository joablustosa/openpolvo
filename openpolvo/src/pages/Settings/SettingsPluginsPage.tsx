import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Loader2,
  Mail,
  MessageCircle,
  Save,
  Share2,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAuth } from "@/auth/AuthContext";
import * as mail from "@/lib/mailApi";
import * as meta from "@/lib/metaApi";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type PluginId = "smtp" | "whatsapp" | "facebook" | "instagram";

type PluginMeta = {
  id: PluginId;
  icon: LucideIcon;
  color: string;
  name: string;
  publisher: string;
  description: string;
  category: string;
};

const PLUGINS: PluginMeta[] = [
  {
    id: "smtp",
    icon: Mail,
    color: "bg-blue-500",
    name: "Correio (SMTP)",
    publisher: "Open Polvo",
    description: "Envio de e-mails pelo agente via servidor SMTP próprio.",
    category: "Comunicação",
  },
  {
    id: "whatsapp",
    icon: MessageCircle,
    color: "bg-emerald-500",
    name: "WhatsApp Business",
    publisher: "Meta",
    description: "Enviar e receber mensagens via WhatsApp Business Cloud API.",
    category: "Mensagens",
  },
  {
    id: "facebook",
    icon: Share2,
    color: "bg-blue-600",
    name: "Facebook Pages",
    publisher: "Meta",
    description: "Publicar conteúdo em Páginas de Facebook a partir do agente.",
    category: "Redes Sociais",
  },
  {
    id: "instagram",
    icon: Camera,
    color: "bg-pink-500",
    name: "Instagram Business",
    publisher: "Meta",
    description: "Publicar posts e stories no Instagram Business.",
    category: "Redes Sociais",
  },
];

// ─── Estado global de settings (carregado uma vez) ────────────────────────────

type SmtpState = {
  host: string; port: string; username: string; password: string;
  fromEmail: string; fromName: string; useTLS: boolean;
  emailChatSkipConfirmation: boolean; hadPassword: boolean;
};

type MetaState = {
  appID: string; appSecret: string; appSecretSet: boolean;
  waPhoneNumberID: string; waToken: string; waTokenSet: boolean;
  fbPageID: string; fbPageToken: string; fbTokenSet: boolean;
  igAccountID: string; igToken: string; igTokenSet: boolean;
  webhookVerifyToken: string;
};

const defaultSmtp = (): SmtpState => ({
  host: "", port: "587", username: "", password: "",
  fromEmail: "", fromName: "", useTLS: true,
  emailChatSkipConfirmation: false, hadPassword: false,
});

const defaultMeta = (): MetaState => ({
  appID: "", appSecret: "", appSecretSet: false,
  waPhoneNumberID: "", waToken: "", waTokenSet: false,
  fbPageID: "", fbPageToken: "", fbTokenSet: false,
  igAccountID: "", igToken: "", igTokenSet: false,
  webhookVerifyToken: "",
});

// ─── Helpers de UI ────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}

function Field({
  label, hint, value, onChange, placeholder, type = "text", isSet,
}: {
  label: string; hint?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; isSet?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <FieldLabel>{label}</FieldLabel>
        {isSet && <CheckCircle2 className="size-3 text-emerald-500" />}
      </div>
      {hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}
      <Input
        className="h-8 text-xs font-mono"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function SectionBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/10 p-4">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

function FeedbackRow({ err, ok }: { err: string | null; ok: string | null }) {
  return (
    <>
      {err ? <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{err}</p> : null}
      {ok ? <p className="rounded-md bg-primary/10 p-2 text-xs text-primary">{ok}</p> : null}
    </>
  );
}

// ─── Painel SMTP ──────────────────────────────────────────────────────────────

function SmtpPanel({
  token, s, setS, onSaved,
}: {
  token: string;
  s: SmtpState;
  setS: React.Dispatch<React.SetStateAction<SmtpState>>;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  // test send state
  const [sendTo, setSendTo] = useState("");
  const [sendSub, setSendSub] = useState("Teste Open Polvo");
  const [sendBody, setSendBody] = useState("Mensagem de teste.");
  const [sending, setSending] = useState(false);

  const set = <K extends keyof SmtpState>(k: K, v: SmtpState[K]) =>
    setS((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true); setErr(null); setOk(null);
    try {
      await mail.putSmtpSettings(token, {
        host: s.host.trim(), port: parseInt(s.port, 10) || 587,
        username: s.username.trim(), password: s.password.trim() || undefined,
        from_email: s.fromEmail.trim(), from_name: s.fromName.trim(),
        use_tls: s.useTLS, email_chat_skip_confirmation: s.emailChatSkipConfirmation,
      });
      setOk("Configuração SMTP guardada."); set("password", ""); onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : "Erro ao guardar"); }
    finally { setSaving(false); }
  };

  const testConn = async () => {
    setTesting(true); setErr(null); setOk(null);
    try { await mail.testSmtpConnection(token); setOk("Ligação SMTP OK."); }
    catch (e) { setErr(e instanceof Error ? e.message : "Falha na ligação"); }
    finally { setTesting(false); }
  };

  const sendTest = async () => {
    setSending(true); setErr(null); setOk(null);
    try {
      await mail.sendEmail(token, { to: sendTo.trim(), subject: sendSub.trim(), body: sendBody });
      setOk("E-mail de teste enviado.");
    } catch (e) { setErr(e instanceof Error ? e.message : "Erro ao enviar"); }
    finally { setSending(false); }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Configura o servidor SMTP para o Zé Polvinho enviar e-mails em teu nome.
        A password é guardada cifrada (AES-256-GCM).
      </p>

      <SectionBox title="Servidor">
        <Field
          label="Host SMTP"
          value={s.host}
          onChange={(v) => set("host", v)}
          placeholder="smtp.gmail.com"
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Porta" value={s.port} onChange={(v) => set("port", v)} placeholder="587" />
          <label className="flex cursor-pointer items-end gap-2 pb-1 text-xs">
            <input
              type="checkbox"
              className="size-3.5 rounded border-input"
              checked={s.useTLS}
              onChange={(e) => set("useTLS", e.target.checked)}
            />
            STARTTLS / TLS
          </label>
        </div>
      </SectionBox>

      <SectionBox title="Credenciais">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Utilizador" value={s.username} onChange={(v) => set("username", v)} />
          <Field
            label="Password SMTP"
            hint={s.hadPassword ? "Deixa em branco para manter" : undefined}
            type="password"
            value={s.password}
            onChange={(v) => set("password", v)}
            placeholder={s.hadPassword ? "••••• (mantida)" : ""}
            isSet={s.hadPassword}
          />
        </div>
      </SectionBox>

      <SectionBox title="Remetente">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="E-mail (From)" value={s.fromEmail} onChange={(v) => set("fromEmail", v)} placeholder="eu@dominio.com" />
          <Field label="Nome a mostrar" value={s.fromName} onChange={(v) => set("fromName", v)} placeholder="João Silva" />
        </div>
      </SectionBox>

      <SectionBox title="Comportamento no chat">
        <label className="flex cursor-pointer items-start gap-2 text-xs leading-snug">
          <input
            type="checkbox"
            className="mt-0.5 size-3.5 shrink-0 rounded border-input"
            checked={s.emailChatSkipConfirmation}
            onChange={(e) => set("emailChatSkipConfirmation", e.target.checked)}
          />
          <span>
            <span className="font-medium text-foreground">Enviar directamente</span> — sem pedir confirmação
            quando o agente tiver destinatário e texto prontos.
          </span>
        </label>
      </SectionBox>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="gap-2" disabled={saving} onClick={() => void save()}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Guardar
        </Button>
        {s.hadPassword && (
          <Button size="sm" variant="outline" className="gap-2" disabled={testing} onClick={() => void testConn()}>
            {testing ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Testar ligação
          </Button>
        )}
      </div>

      <FeedbackRow err={err} ok={ok} />

      {s.hadPassword && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground/70 hover:text-foreground">
            Enviar e-mail de teste
          </summary>
          <div className="mt-3 space-y-2 rounded-lg border border-border bg-muted/10 p-3">
            <Input className="h-7 text-xs" placeholder="Para (e-mail)" value={sendTo} onChange={(e) => setSendTo(e.target.value)} />
            <Input className="h-7 text-xs" placeholder="Assunto" value={sendSub} onChange={(e) => setSendSub(e.target.value)} />
            <Textarea className="min-h-[60px] text-xs" value={sendBody} onChange={(e) => setSendBody(e.target.value)} />
            <Button size="sm" variant="secondary" disabled={sending || !sendTo.trim()} onClick={() => void sendTest()}>
              {sending ? <Loader2 className="size-3 animate-spin" /> : "Enviar"}
            </Button>
          </div>
        </details>
      )}
    </div>
  );
}

// ─── Painel Meta compartilhado ────────────────────────────────────────────────

function WhatsAppPanel({
  token, s, setS, onSaved,
}: {
  token: string;
  s: MetaState;
  setS: React.Dispatch<React.SetStateAction<MetaState>>;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const set = <K extends keyof MetaState>(k: K, v: MetaState[K]) =>
    setS((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true); setErr(null); setOk(null);
    try {
      await meta.putMetaSettings(token, {
        app_id: s.appID.trim(),
        app_secret: s.appSecret.trim() || undefined,
        wa_phone_number_id: s.waPhoneNumberID.trim(),
        wa_access_token: s.waToken.trim() || undefined,
        webhook_verify_token: s.webhookVerifyToken.trim(),
      });
      setOk("Configuração WhatsApp guardada.");
      set("waToken", ""); set("appSecret", "");
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : "Erro ao guardar"); }
    finally { setSaving(false); }
  };

  const testConn = async () => {
    setTesting(true); setErr(null); setOk(null);
    try { await meta.testMetaConnection(token); setOk("Ligação Meta OK."); }
    catch (e) { setErr(e instanceof Error ? e.message : "Falha"); }
    finally { setTesting(false); }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Conecta a tua conta WhatsApp Business Cloud para o agente enviar e receber mensagens.
        Tokens guardados cifrados (AES-256-GCM).
      </p>

      <SectionBox title="Meta App">
        <p className="text-[10px] text-muted-foreground">
          Cria uma App em <span className="font-mono text-primary">developers.facebook.com</span> e
          adiciona o produto WhatsApp.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="App ID" value={s.appID} onChange={(v) => set("appID", v)} placeholder="123456789..." />
          <Field
            label="App Secret"
            hint={s.appSecretSet ? "Deixa em branco para manter" : undefined}
            type="password"
            value={s.appSecret}
            onChange={(v) => set("appSecret", v)}
            placeholder={s.appSecretSet ? "••••• (mantido)" : "App Secret"}
            isSet={s.appSecretSet}
          />
        </div>
      </SectionBox>

      <SectionBox title="WhatsApp Business Cloud API">
        <p className="text-[10px] text-muted-foreground">
          Obtém o <strong>Phone Number ID</strong> e um <strong>Permanent Access Token</strong> em
          System Users com permissão <code className="rounded bg-muted px-0.5">whatsapp_business_messaging</code>.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Phone Number ID" value={s.waPhoneNumberID} onChange={(v) => set("waPhoneNumberID", v)} placeholder="1234567890..." />
          <Field
            label="Access Token"
            hint={s.waTokenSet ? "Deixa em branco para manter" : undefined}
            type="password"
            value={s.waToken}
            onChange={(v) => set("waToken", v)}
            placeholder={s.waTokenSet ? "••••• (mantido)" : "EAABsbCS..."}
            isSet={s.waTokenSet}
          />
        </div>
      </SectionBox>

      <SectionBox title="Webhook (receber mensagens)">
        <p className="text-[10px] text-muted-foreground">
          Regista <span className="font-mono text-primary">https://{"<"}api{">"}/meta/webhook</span> no
          painel Meta. O <strong>Verify Token</strong> abaixo deve coincidir com o que defines lá.
        </p>
        <Field
          label="Verify Token"
          value={s.webhookVerifyToken}
          onChange={(v) => set("webhookVerifyToken", v)}
          placeholder="token-secreto-webhook"
        />
      </SectionBox>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="gap-2" disabled={saving} onClick={() => void save()}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Guardar
        </Button>
        <Button size="sm" variant="outline" className="gap-2" disabled={testing} onClick={() => void testConn()}>
          {testing ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Testar ligação
        </Button>
      </div>
      <FeedbackRow err={err} ok={ok} />
    </div>
  );
}

function FacebookPanel({
  token, s, setS, onSaved,
}: {
  token: string;
  s: MetaState;
  setS: React.Dispatch<React.SetStateAction<MetaState>>;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const set = <K extends keyof MetaState>(k: K, v: MetaState[K]) =>
    setS((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true); setErr(null); setOk(null);
    try {
      await meta.putMetaSettings(token, {
        app_id: s.appID.trim(),
        app_secret: s.appSecret.trim() || undefined,
        fb_page_id: s.fbPageID.trim(),
        fb_page_token: s.fbPageToken.trim() || undefined,
      });
      setOk("Configuração Facebook guardada.");
      set("fbPageToken", ""); set("appSecret", "");
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : "Erro ao guardar"); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Liga uma Página de Facebook para o agente publicar conteúdo directamente.
      </p>

      <SectionBox title="Meta App">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="App ID" value={s.appID} onChange={(v) => set("appID", v)} placeholder="123456789..." />
          <Field
            label="App Secret"
            hint={s.appSecretSet ? "Deixa em branco para manter" : undefined}
            type="password"
            value={s.appSecret}
            onChange={(v) => set("appSecret", v)}
            placeholder={s.appSecretSet ? "••••• (mantido)" : "App Secret"}
            isSet={s.appSecretSet}
          />
        </div>
      </SectionBox>

      <SectionBox title="Facebook Page">
        <p className="text-[10px] text-muted-foreground">
          Vai a <span className="font-mono text-primary">graph.facebook.com/me/accounts</span> com o
          teu User Token para obter o <strong>Page ID</strong> e o{" "}
          <strong>Page Access Token</strong>.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Page ID" value={s.fbPageID} onChange={(v) => set("fbPageID", v)} placeholder="123456789..." />
          <Field
            label="Page Access Token"
            hint={s.fbTokenSet ? "Deixa em branco para manter" : undefined}
            type="password"
            value={s.fbPageToken}
            onChange={(v) => set("fbPageToken", v)}
            placeholder={s.fbTokenSet ? "••••• (mantido)" : "EAABsbCS..."}
            isSet={s.fbTokenSet}
          />
        </div>
      </SectionBox>

      <Button size="sm" className="gap-2" disabled={saving} onClick={() => void save()}>
        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
        Guardar
      </Button>
      <FeedbackRow err={err} ok={ok} />
    </div>
  );
}

function InstagramPanel({
  token, s, setS, onSaved,
}: {
  token: string;
  s: MetaState;
  setS: React.Dispatch<React.SetStateAction<MetaState>>;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const set = <K extends keyof MetaState>(k: K, v: MetaState[K]) =>
    setS((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true); setErr(null); setOk(null);
    try {
      await meta.putMetaSettings(token, {
        app_id: s.appID.trim(),
        app_secret: s.appSecret.trim() || undefined,
        ig_account_id: s.igAccountID.trim(),
        ig_access_token: s.igToken.trim() || undefined,
        fb_page_id: s.fbPageID.trim(),
        fb_page_token: s.fbPageToken.trim() || undefined,
      });
      setOk("Configuração Instagram guardada.");
      set("igToken", ""); set("appSecret", "");
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : "Erro ao guardar"); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Liga uma conta Instagram Business para o agente publicar posts e stories.
        Requer também a Página de Facebook associada ao Instagram.
      </p>

      <SectionBox title="Meta App">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="App ID" value={s.appID} onChange={(v) => set("appID", v)} placeholder="123456789..." />
          <Field
            label="App Secret"
            hint={s.appSecretSet ? "Deixa em branco para manter" : undefined}
            type="password"
            value={s.appSecret}
            onChange={(v) => set("appSecret", v)}
            placeholder={s.appSecretSet ? "••••• (mantido)" : "App Secret"}
            isSet={s.appSecretSet}
          />
        </div>
      </SectionBox>

      <SectionBox title="Instagram Business">
        <p className="text-[10px] text-muted-foreground">
          Obtém o <strong>Instagram Business Account ID</strong> via{" "}
          <span className="font-mono text-primary">
            graph.facebook.com/{"{"}<wbr />page-id{"}"}/instagram_accounts
          </span>
          . O token é o mesmo da Página Facebook ligada.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field
            label="Instagram Account ID"
            value={s.igAccountID}
            onChange={(v) => set("igAccountID", v)}
            placeholder="17841456789..."
          />
          <Field
            label="Access Token"
            hint={s.igTokenSet ? "Deixa em branco para manter" : undefined}
            type="password"
            value={s.igToken}
            onChange={(v) => set("igToken", v)}
            placeholder={s.igTokenSet ? "••••• (mantido)" : "EAABsbCS..."}
            isSet={s.igTokenSet}
          />
        </div>
      </SectionBox>

      <SectionBox title="Página Facebook associada (necessária para publicar)">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Page ID" value={s.fbPageID} onChange={(v) => set("fbPageID", v)} placeholder="123456789..." />
          <Field
            label="Page Access Token"
            hint={s.fbTokenSet ? "Deixa em branco para manter" : undefined}
            type="password"
            value={s.fbPageToken}
            onChange={(v) => set("fbPageToken", v)}
            placeholder={s.fbTokenSet ? "••••• (mantido)" : "EAABsbCS..."}
            isSet={s.fbTokenSet}
          />
        </div>
      </SectionBox>

      <Button size="sm" className="gap-2" disabled={saving} onClick={() => void save()}>
        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
        Guardar
      </Button>
      <FeedbackRow err={err} ok={ok} />
    </div>
  );
}

// ─── Item da lista de plugins ─────────────────────────────────────────────────

function PluginListItem({
  plugin, active, configured, onClick,
}: {
  plugin: PluginMeta;
  active: boolean;
  configured: boolean;
  onClick: () => void;
}) {
  const Icon = plugin.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-md px-3 py-3 text-left transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "hover:bg-muted/50 text-foreground",
      )}
    >
      <div className="flex items-start gap-3">
        {/* ícone */}
        <div
          className={cn(
            "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg",
            plugin.color,
          )}
        >
          <Icon className="size-4.5 text-white" />
        </div>

        {/* texto */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <span className="truncate text-sm font-medium">{plugin.name}</span>
            {configured && (
              <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
            )}
          </div>
          <p className="truncate text-[10px] text-muted-foreground">{plugin.publisher}</p>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
            {plugin.description}
          </p>
        </div>
      </div>
    </button>
  );
}

// ─── Cabeçalho do painel direito ──────────────────────────────────────────────

function PluginHeader({ plugin, configured }: { plugin: PluginMeta; configured: boolean }) {
  const Icon = plugin.icon;
  return (
    <div className="flex items-start gap-4 border-b border-border pb-5">
      <div className={cn("flex size-16 shrink-0 items-center justify-center rounded-xl", plugin.color)}>
        <Icon className="size-8 text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">{plugin.name}</h2>
          {configured ? (
            <span className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-3" /> Configurado
            </span>
          ) : (
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              Não configurado
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{plugin.publisher}</p>
        <p className="mt-1 text-xs text-muted-foreground">{plugin.description}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {plugin.category}
          </span>
          {plugin.id === "whatsapp" || plugin.id === "facebook" || plugin.id === "instagram" ? (
            <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              Meta Graph API
            </span>
          ) : null}
          {plugin.id === "smtp" ? (
            <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              AES-256-GCM
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export function SettingsPluginsPage() {
  const { token } = useAuth();
  const [selected, setSelected] = useState<PluginId>("smtp");
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [smtpState, setSmtpState] = useState<SmtpState>(defaultSmtp());
  const [metaState, setMetaState] = useState<MetaState>(defaultMeta());

  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoadingSettings(true);
    try {
      const [smtpRes, metaRes] = await Promise.allSettled([
        mail.getSmtpSettings(token),
        meta.getMetaSettings(token),
      ]);
      if (smtpRes.status === "fulfilled") {
        const s = smtpRes.value;
        setSmtpState({
          host: s.host || "", port: String(s.port || 587), username: s.username || "",
          password: "", fromEmail: s.from_email || "", fromName: s.from_name || "",
          useTLS: s.use_tls !== false,
          emailChatSkipConfirmation: Boolean(s.email_chat_skip_confirmation),
          hadPassword: s.password_set,
        });
      }
      if (metaRes.status === "fulfilled") {
        const m = metaRes.value;
        setMetaState({
          appID: m.app_id || "", appSecret: "", appSecretSet: m.app_secret_set,
          waPhoneNumberID: m.wa_phone_number_id || "", waToken: "", waTokenSet: m.wa_token_set,
          fbPageID: m.fb_page_id || "", fbPageToken: "", fbTokenSet: m.fb_page_token_set,
          igAccountID: m.ig_account_id || "", igToken: "", igTokenSet: m.ig_token_set,
          webhookVerifyToken: m.webhook_verify_token || "",
        });
      }
    } finally {
      setLoadingSettings(false);
    }
  }, [token]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  if (!token) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
        <p>Inicie sessão para ver as integrações.</p>
        <Link to="/" className={buttonVariants({ variant: "outline", size: "sm" })}>Voltar</Link>
      </div>
    );
  }

  const smtpConfigured = Boolean(smtpState.host?.trim() && smtpState.hadPassword);
  const configured: Record<PluginId, boolean> = {
    smtp: smtpConfigured,
    whatsapp: metaState.waTokenSet,
    facebook: metaState.fbTokenSet,
    instagram: metaState.igTokenSet,
  };

  const selectedPlugin = PLUGINS.find((p) => p.id === selected)!;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
      {/* header */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <Link to="/settings" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-2")}>
          <ArrowLeft className="size-4" />
          Definições
        </Link>
        <div className="h-4 w-px bg-border" />
        <Zap className="size-4 text-primary" />
        <h1 className="text-sm font-semibold">Integrações</h1>
        <span className="text-xs text-muted-foreground">
          {Object.values(configured).filter(Boolean).length} de {PLUGINS.length} configuradas
        </span>
      </header>

      {loadingSettings ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> A carregar…
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* lista esquerda */}
          <aside className="flex w-[260px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-border p-2">
            <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Comunicação
            </p>
            {PLUGINS.filter((p) => p.category === "Comunicação" || p.category === "Mensagens" || p.id === "whatsapp").map((plugin) => (
              <PluginListItem
                key={plugin.id}
                plugin={plugin}
                active={selected === plugin.id}
                configured={configured[plugin.id]}
                onClick={() => setSelected(plugin.id)}
              />
            ))}
            <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Redes Sociais
            </p>
            {PLUGINS.filter((p) => p.category === "Redes Sociais").map((plugin) => (
              <PluginListItem
                key={plugin.id}
                plugin={plugin}
                active={selected === plugin.id}
                configured={configured[plugin.id]}
                onClick={() => setSelected(plugin.id)}
              />
            ))}
          </aside>

          {/* painel direito */}
          <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="mx-auto w-full max-w-2xl space-y-6 p-6">
              <PluginHeader plugin={selectedPlugin} configured={configured[selected]} />

              <div>
                <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Configuração
                </h3>
                {selected === "smtp" && (
                  <SmtpPanel token={token} s={smtpState} setS={setSmtpState} onSaved={loadAll} />
                )}
                {selected === "whatsapp" && (
                  <WhatsAppPanel token={token} s={metaState} setS={setMetaState} onSaved={loadAll} />
                )}
                {selected === "facebook" && (
                  <FacebookPanel token={token} s={metaState} setS={setMetaState} onSaved={loadAll} />
                )}
                {selected === "instagram" && (
                  <InstagramPanel token={token} s={metaState} setS={setMetaState} onSaved={loadAll} />
                )}
              </div>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
