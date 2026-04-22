import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Loader2, Save, Share2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import * as meta from "@/lib/metaApi";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/15 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  type = "text",
  isSet,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  isSet?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
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

export function SettingsMetaPage() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [appID, setAppID] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [appSecretSet, setAppSecretSet] = useState(false);

  const [waPhoneNumberID, setWaPhoneNumberID] = useState("");
  const [waToken, setWaToken] = useState("");
  const [waTokenSet, setWaTokenSet] = useState(false);

  const [fbPageID, setFbPageID] = useState("");
  const [fbPageToken, setFbPageToken] = useState("");
  const [fbTokenSet, setFbTokenSet] = useState(false);

  const [igAccountID, setIgAccountID] = useState("");
  const [igToken, setIgToken] = useState("");
  const [igTokenSet, setIgTokenSet] = useState(false);

  const [webhookVerifyToken, setWebhookVerifyToken] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const s = await meta.getMetaSettings(token);
      setAppID(s.app_id || "");
      setAppSecretSet(s.app_secret_set);
      setWaPhoneNumberID(s.wa_phone_number_id || "");
      setWaTokenSet(s.wa_token_set);
      setFbPageID(s.fb_page_id || "");
      setFbTokenSet(s.fb_page_token_set);
      setIgAccountID(s.ig_account_id || "");
      setIgTokenSet(s.ig_token_set);
      setWebhookVerifyToken(s.webhook_verify_token || "");
      setAppSecret("");
      setWaToken("");
      setFbPageToken("");
      setIgToken("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!token) return;
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      await meta.putMetaSettings(token, {
        app_id: appID.trim(),
        app_secret: appSecret.trim() || undefined,
        wa_phone_number_id: waPhoneNumberID.trim(),
        wa_access_token: waToken.trim() || undefined,
        fb_page_id: fbPageID.trim(),
        fb_page_token: fbPageToken.trim() || undefined,
        ig_account_id: igAccountID.trim(),
        ig_access_token: igToken.trim() || undefined,
        webhook_verify_token: webhookVerifyToken.trim(),
      });
      setOk("Configuração guardada.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao guardar");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (!token) return;
    setTesting(true);
    setErr(null);
    setOk(null);
    try {
      await meta.testMetaConnection(token);
      setOk("Ligação Meta testada com sucesso.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha no teste");
    } finally {
      setTesting(false);
    }
  };

  if (!token) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
        <p>Inicie sessão para ver definições.</p>
        <Link to="/" className={buttonVariants({ variant: "outline", size: "sm" })}>Voltar</Link>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-auto bg-background">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <Link to="/settings" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-2")}>
          <ArrowLeft className="size-4" />
          Definições
        </Link>
        <div className="h-4 w-px bg-border" />
        <Share2 className="size-4 text-primary" />
        <h1 className="text-sm font-semibold">Integração Meta</h1>
      </header>

      <div className="mx-auto w-full max-w-lg flex-1 space-y-6 p-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> A carregar…
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Liga a tua conta Meta para o Zé Polvinho publicar no Facebook, Instagram e responder mensagens do
              WhatsApp Business. Os tokens são guardados cifrados (AES-256-GCM).
            </p>

            <Section title="Meta App (App ID / App Secret)">
              <p className="text-[10px] text-muted-foreground">
                Cria uma App em{" "}
                <span className="font-mono text-primary">developers.facebook.com</span>, adiciona os produtos
                WhatsApp, Messenger e Instagram e obtém o App ID e App Secret.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="App ID" value={appID} onChange={setAppID} placeholder="123456789..." />
                <Field
                  label="App Secret"
                  hint={appSecretSet ? "Já guardado — deixa em branco para manter" : undefined}
                  value={appSecret}
                  onChange={setAppSecret}
                  type="password"
                  placeholder={appSecretSet ? "••••••• (mantido)" : "App Secret"}
                  isSet={appSecretSet}
                />
              </div>
            </Section>

            <Section title="WhatsApp Business Cloud API">
              <p className="text-[10px] text-muted-foreground">
                No painel WhatsApp da tua App Meta obtém o{" "}
                <strong>Phone Number ID</strong> e um{" "}
                <strong>Permanent Access Token</strong> (gera em System Users com permissão whatsapp_business_messaging).
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field
                  label="Phone Number ID"
                  value={waPhoneNumberID}
                  onChange={setWaPhoneNumberID}
                  placeholder="1234567890..."
                />
                <Field
                  label="Access Token"
                  hint={waTokenSet ? "Já guardado — deixa em branco para manter" : undefined}
                  value={waToken}
                  onChange={setWaToken}
                  type="password"
                  placeholder={waTokenSet ? "••••••• (mantido)" : "EAABsbCS..."}
                  isSet={waTokenSet}
                />
              </div>
            </Section>

            <Section title="Facebook Page">
              <p className="text-[10px] text-muted-foreground">
                Vai a{" "}
                <span className="font-mono text-primary">graph.facebook.com/me/accounts</span> com o teu
                User Token para obter o <strong>Page ID</strong> e o <strong>Page Access Token</strong>{" "}
                (converte para permanent via token de longa duração).
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Page ID" value={fbPageID} onChange={setFbPageID} placeholder="123456789..." />
                <Field
                  label="Page Access Token"
                  hint={fbTokenSet ? "Já guardado — deixa em branco para manter" : undefined}
                  value={fbPageToken}
                  onChange={setFbPageToken}
                  type="password"
                  placeholder={fbTokenSet ? "••••••• (mantido)" : "EAABsbCS..."}
                  isSet={fbTokenSet}
                />
              </div>
            </Section>

            <Section title="Instagram Business">
              <p className="text-[10px] text-muted-foreground">
                O <strong>Instagram Business Account ID</strong> obtém-se em{" "}
                <span className="font-mono text-primary">
                  graph.facebook.com/{"{"}page-id{"}"}/instagram_accounts
                </span>
                . O Access Token é o mesmo da Página de Facebook associada.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field
                  label="Instagram Account ID"
                  value={igAccountID}
                  onChange={setIgAccountID}
                  placeholder="17841456789..."
                />
                <Field
                  label="Access Token"
                  hint={igTokenSet ? "Já guardado — deixa em branco para manter" : undefined}
                  value={igToken}
                  onChange={setIgToken}
                  type="password"
                  placeholder={igTokenSet ? "••••••• (mantido)" : "EAABsbCS..."}
                  isSet={igTokenSet}
                />
              </div>
            </Section>

            <Section title="Webhook (receber mensagens)">
              <p className="text-[10px] text-muted-foreground">
                No painel Meta regista o URL de webhook como{" "}
                <span className="font-mono text-primary">
                  https://{"<"}tua-api{">"}/meta/webhook
                </span>{" "}
                e define o <strong>Verify Token</strong> abaixo (qualquer string aleatória). Subscreve os campos{" "}
                <code className="rounded bg-muted px-0.5">messages</code>.
              </p>
              <Field
                label="Verify Token (hub.verify_token)"
                value={webhookVerifyToken}
                onChange={setWebhookVerifyToken}
                placeholder="meu-token-secreto-webhook"
              />
            </Section>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="gap-2" disabled={saving} onClick={() => void save()}>
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                Guardar
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                disabled={testing}
                onClick={() => void test()}
              >
                {testing ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Testar ligação
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
