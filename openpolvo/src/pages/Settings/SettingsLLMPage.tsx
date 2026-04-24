import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Cpu, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import * as llm from "@/lib/llmProfilesApi";

export function SettingsLLMPage() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<llm.LlmProfileDTO[]>([]);
  const [prefs, setPrefs] = useState<llm.LlmAgentPrefsDTO | null>(null);

  const [newName, setNewName] = useState("");
  const [newProvider, setNewProvider] = useState<"openai" | "google">("openai");
  const [newModelId, setNewModelId] = useState("gpt-4.1-mini");
  const [newKey, setNewKey] = useState("");
  const [newOrder, setNewOrder] = useState("0");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const [plist, ap] = await Promise.all([
        llm.fetchLlmProfiles(token),
        llm.getLlmAgentPrefs(token),
      ]);
      setProfiles(plist);
      setPrefs(ap);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const savePrefs = async () => {
    if (!token || !prefs) return;
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      const body: { agent_mode: "auto" | "profile"; default_profile_id?: string | null } = {
        agent_mode: prefs.agent_mode,
      };
      if (prefs.agent_mode === "profile") {
        body.default_profile_id = prefs.default_profile_id ?? null;
      } else {
        body.default_profile_id = null;
      }
      const next = await llm.putLlmAgentPrefs(token, body);
      setPrefs(next);
      setOk("Preferências do agente guardadas.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao guardar");
    } finally {
      setSaving(false);
    }
  };

  const addProfile = async () => {
    if (!token) return;
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      await llm.createLlmProfile(token, {
        display_name: newName.trim(),
        provider: newProvider,
        model_id: newModelId.trim(),
        api_key: newKey.trim(),
        sort_order: parseInt(newOrder, 10) || 0,
      });
      setNewName("");
      setNewKey("");
      setOk("Perfil criado.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao criar");
    } finally {
      setSaving(false);
    }
  };

  const removeProfile = async (id: string) => {
    if (!token) return;
    if (!window.confirm("Eliminar este perfil?")) return;
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      await llm.deleteLlmProfile(token, id);
      setOk("Perfil eliminado.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao eliminar");
    } finally {
      setSaving(false);
    }
  };

  if (!token) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
        <p>Inicie sessão para configurar modelos LLM.</p>
        <Link to="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Voltar
        </Link>
      </div>
    );
  }

  const keyed = profiles.filter((p) => p.has_api_key);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-auto bg-background">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <Link
          to="/settings"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-2")}
        >
          <ArrowLeft className="size-4" />
          Definições
        </Link>
        <div className="h-4 w-px bg-border" />
        <Cpu className="size-4 text-primary" />
        <h1 className="text-sm font-semibold">Modelos LLM</h1>
      </header>

      <div className="mx-auto w-full max-w-lg flex-1 space-y-6 p-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> A carregar…
          </div>
        ) : null}

        {err ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {err}
          </p>
        ) : null}
        {ok ? (
          <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground">
            {ok}
          </p>
        ) : null}

        <p className="text-xs text-muted-foreground">
          As chaves são gravadas localmente na base SQLite da API (cifradas) e enviadas ao Open Polvo
          Intelligence apenas em pedidos locais. O modo <strong>Automático</strong> no chat usa estas
          preferências e os perfis com chave.
        </p>

        {prefs ? (
          <section className="space-y-3 rounded-lg border border-border bg-muted/15 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Agente (modo automático)
            </h2>
            <p className="text-xs text-muted-foreground">
              Quando escolhe <strong>Automático</strong> no chat: em modo <em>automático</em> usa o
              primeiro perfil com chave (por ordem); em modo <em>perfil por defeito</em> usa sempre o
              perfil seleccionado abaixo.
            </p>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="agent_mode"
                  checked={prefs.agent_mode === "auto"}
                  onChange={() => setPrefs({ ...prefs, agent_mode: "auto", default_profile_id: null })}
                />
                Automático (primeiro perfil com chave)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="agent_mode"
                  checked={prefs.agent_mode === "profile"}
                  onChange={() => setPrefs({ ...prefs, agent_mode: "profile" })}
                />
                Sempre o perfil por defeito
              </label>
            </div>
            {prefs.agent_mode === "profile" ? (
              <div className="space-y-1">
                <span className="text-[11px] text-muted-foreground">Perfil por defeito</span>
                <Select
                  value={prefs.default_profile_id ?? "__none__"}
                  onValueChange={(v) =>
                    setPrefs({
                      ...prefs,
                      default_profile_id: v === "__none__" ? null : v,
                    })
                  }
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Escolher perfil" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {keyed.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.display_name} ({p.provider})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <Button type="button" size="sm" disabled={saving} onClick={() => void savePrefs()}>
              <Save className="size-3.5" />
              Guardar preferências
            </Button>
          </section>
        ) : null}

        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Novo perfil
          </h2>
          <div className="grid gap-2">
            <Input
              className="h-9 text-sm"
              placeholder="Nome (ex.: Conta pessoal OpenAI)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={newProvider}
                onValueChange={(v) => setNewProvider(v as "openai" | "google")}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="google">Google (Gemini)</SelectItem>
                </SelectContent>
              </Select>
              <Input
                className="h-9 text-sm"
                placeholder="ID do modelo"
                value={newModelId}
                onChange={(e) => setNewModelId(e.target.value)}
              />
            </div>
            <Input
              className="h-9 text-sm"
              type="password"
              placeholder="API key"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              autoComplete="off"
            />
            <Input
              className="h-9 text-sm"
              placeholder="Ordem (0 = primeiro)"
              value={newOrder}
              onChange={(e) => setNewOrder(e.target.value)}
            />
            <Button
              type="button"
              size="sm"
              disabled={
                saving || !newName.trim() || !newModelId.trim() || !newKey.trim()
              }
              onClick={() => void addProfile()}
            >
              <Plus className="size-3.5" />
              Adicionar perfil
            </Button>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Perfis
          </h2>
          {profiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum perfil ainda.</p>
          ) : (
            <ul className="space-y-2">
              {profiles.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-3 text-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{p.display_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.provider} · {p.model_id}
                        {p.has_api_key ? "" : " · sem chave"}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-destructive"
                      title="Eliminar"
                      disabled={saving}
                      onClick={() => void removeProfile(p.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <ProfileInlineEditor token={token} profile={p} onSaved={load} disabled={saving} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function ProfileInlineEditor({
  token,
  profile,
  onSaved,
  disabled,
}: {
  token: string;
  profile: llm.LlmProfileDTO;
  onSaved: () => Promise<void>;
  disabled: boolean;
}) {
  const [modelId, setModelId] = useState(profile.model_id);
  const [name, setName] = useState(profile.display_name);
  const [key, setKey] = useState("");
  const [order, setOrder] = useState(String(profile.sort_order));
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setLocalErr(null);
    try {
      await llm.patchLlmProfile(token, profile.id, {
        display_name: name.trim() || undefined,
        model_id: modelId.trim() || undefined,
        sort_order: parseInt(order, 10) || 0,
        ...(key.trim() ? { api_key: key.trim() } : {}),
      });
      setKey("");
      await onSaved();
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 border-t border-border/60 pt-2">
      {localErr ? <p className="text-xs text-destructive">{localErr}</p> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <Input className="h-8 text-xs" value={name} onChange={(e) => setName(e.target.value)} />
        <Input className="h-8 text-xs" value={modelId} onChange={(e) => setModelId(e.target.value)} />
        <Input
          className="h-8 text-xs sm:col-span-2"
          type="password"
          placeholder={profile.has_api_key ? "Nova API key (opcional)" : "API key"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoComplete="off"
        />
        <Input className="h-8 text-xs" value={order} onChange={(e) => setOrder(e.target.value)} />
      </div>
      <Button type="button" size="sm" variant="secondary" disabled={disabled || busy} onClick={() => void save()}>
        Actualizar
      </Button>
    </div>
  );
}
