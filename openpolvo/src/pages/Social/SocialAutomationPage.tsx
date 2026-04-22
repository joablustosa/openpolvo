import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  ImageOff,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  Share2,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAuth } from "@/auth/AuthContext";
import * as social from "@/lib/socialApi";
import type { SocialPostDTO } from "@/lib/socialApi";

// ─── helpers ────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<SocialPostDTO["status"], string> = {
  generating: "A gerar…",
  pending_approval: "Aguarda aprovação",
  approved: "Aprovado",
  rejected: "Rejeitado",
  published: "Publicado",
  failed: "Falhou",
};

function statusColor(s: SocialPostDTO["status"]): string {
  if (s === "published") return "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/20";
  if (s === "pending_approval") return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20";
  if (s === "approved") return "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20";
  if (s === "rejected" || s === "failed")
    return "bg-destructive/10 text-destructive border-destructive/20";
  return "bg-muted text-muted-foreground border-border";
}

function fmtDate(d: string): string {
  try {
    return new Intl.DateTimeFormat("pt-PT", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(d));
  } catch {
    return d;
  }
}

// ─── config tab ─────────────────────────────────────────────────────────────

function ConfigTab({
  token,
  onSaved,
}: {
  token: string;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [platforms, setPlatforms] = useState<string[]>(["facebook"]);
  const [sites, setSites] = useState<string[]>([""]);
  const [timesPerDay, setTimesPerDay] = useState(1);
  const [approvalPhone, setApprovalPhone] = useState("");
  const [active, setActive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const cfg = await social.getSocialConfig(token);
      if (cfg) {
        setPlatforms(cfg.platforms.length ? cfg.platforms : ["facebook"]);
        setSites(cfg.sites.length ? cfg.sites : [""]);
        setTimesPerDay(cfg.times_per_day || 1);
        setApprovalPhone(cfg.approval_phone || "");
        setActive(cfg.active);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const togglePlatform = (p: string) => {
    setPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  };

  const addSite = () => setSites((s) => [...s, ""]);
  const removeSite = (i: number) => setSites((s) => s.filter((_, idx) => idx !== i));
  const updateSite = (i: number, v: string) =>
    setSites((s) => s.map((x, idx) => (idx === i ? v : x)));

  const save = async () => {
    if (!platforms.length) {
      setErr("Selecciona pelo menos uma plataforma.");
      return;
    }
    const validSites = sites.map((s) => s.trim()).filter(Boolean);
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      await social.putSocialConfig(token, {
        platforms,
        sites: validSites,
        times_per_day: timesPerDay,
        approval_phone: approvalPhone.trim(),
        active,
      });
      setOk("Configuração guardada com sucesso.");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao guardar");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> A carregar…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Plataformas */}
      <div className="space-y-2 rounded-lg border border-border bg-muted/10 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Plataformas de publicação
        </h3>
        <div className="flex flex-wrap gap-2">
          {(["facebook", "instagram"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => togglePlatform(p)}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                platforms.includes(p)
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-transparent text-muted-foreground hover:bg-muted/40",
              )}
            >
              <Share2 className="size-3.5" />
              {p === "facebook" ? "Facebook" : "Instagram"}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Requer as credenciais Meta configuradas em{" "}
          <Link to="/settings/meta" className="text-primary underline">
            Definições → Meta
          </Link>
          .
        </p>
      </div>

      {/* Sites de referência */}
      <div className="space-y-2 rounded-lg border border-border bg-muted/10 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Sites de referência
        </h3>
        <p className="text-[11px] text-muted-foreground">
          O agente vai fazer scraping destes sites para extrair o conteúdo mais relevante.
        </p>
        <div className="space-y-2">
          {sites.map((s, i) => (
            <div key={i} className="flex gap-2">
              <Input
                className="h-8 flex-1 text-xs"
                placeholder="https://exemplo.com/blog"
                value={s}
                onChange={(e) => updateSite(i, e.target.value)}
              />
              {sites.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeSite(i)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
        {sites.length < 5 && (
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={addSite}>
            <Plus className="size-3.5" /> Adicionar site
          </Button>
        )}
      </div>

      {/* Frequência */}
      <div className="space-y-2 rounded-lg border border-border bg-muted/10 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Frequência de publicação
        </h3>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="flex size-7 shrink-0 items-center justify-center rounded border border-border bg-muted/40 text-muted-foreground hover:bg-muted/80 disabled:opacity-40"
            disabled={timesPerDay <= 1}
            onClick={() => setTimesPerDay((n) => Math.max(1, n - 1))}
          >
            <ChevronDown className="size-3.5" />
          </button>
          <span className="min-w-[3rem] text-center text-sm font-semibold tabular-nums">
            {timesPerDay}×/dia
          </span>
          <button
            type="button"
            className="flex size-7 shrink-0 items-center justify-center rounded border border-border bg-muted/40 text-muted-foreground hover:bg-muted/80 disabled:opacity-40"
            disabled={timesPerDay >= 24}
            onClick={() => setTimesPerDay((n) => Math.min(24, n + 1))}
          >
            <ChevronUp className="size-3.5" />
          </button>
          <span className="text-[11px] text-muted-foreground">
            intervalo de{" "}
            {timesPerDay > 1
              ? `${Math.round(24 / timesPerDay)}h`
              : "24h"}{" "}
            entre posts
          </span>
        </div>
      </div>

      {/* Aprovação WhatsApp */}
      <div className="space-y-2 rounded-lg border border-border bg-muted/10 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Aprovação via WhatsApp
        </h3>
        <p className="text-[11px] text-muted-foreground">
          Antes de publicar, o agente envia uma pré-visualização para este número. Responde{" "}
          <strong>SIM</strong> para aprovar ou <strong>NÃO</strong> para rejeitar. Deve
          coincidir com um número configurado no WhatsApp Business.
        </p>
        <Input
          className="h-8 text-xs"
          placeholder="+351912345678"
          value={approvalPhone}
          onChange={(e) => setApprovalPhone(e.target.value)}
        />
      </div>

      {/* Activar automação */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/10 px-4 py-3">
        <div>
          <p className="text-sm font-medium">Automação activa</p>
          <p className="text-[11px] text-muted-foreground">
            Quando activa, o scheduler gera e envia posts automaticamente.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={active}
          onClick={() => setActive((v) => !v)}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active ? "bg-primary" : "bg-input",
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block size-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
              active ? "translate-x-4" : "translate-x-0",
            )}
          />
        </button>
      </div>

      {err && (
        <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{err}</p>
      )}
      {ok && (
        <p className="rounded-md bg-primary/10 p-2 text-xs text-primary">{ok}</p>
      )}

      <Button size="sm" className="gap-2" disabled={saving} onClick={() => void save()}>
        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Settings2 className="size-3.5" />}
        Guardar configuração
      </Button>
    </div>
  );
}

// ─── post card ───────────────────────────────────────────────────────────────

function PostCard({
  post,
  token,
  onRefresh,
}: {
  post: SocialPostDTO;
  token: string;
  onRefresh: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const act = async (action: "approve" | "reject") => {
    setLoading(true);
    setErr(null);
    try {
      if (action === "approve") await social.approvePost(token, post.id);
      else await social.rejectPost(token, post.id);
      onRefresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setLoading(false);
    }
  };

  const canAct =
    post.status === "pending_approval" || post.status === "approved" || post.status === "rejected";

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {/* imagem */}
      {post.image_url ? (
        <div className="relative h-40 w-full overflow-hidden bg-muted">
          <img
            src={post.image_url}
            alt={post.title}
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      ) : (
        <div className="flex h-24 items-center justify-center bg-muted/30">
          <ImageOff className="size-6 text-muted-foreground/40" />
        </div>
      )}

      <div className="space-y-2 p-3">
        {/* header */}
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 text-sm font-medium leading-snug">{post.title || "Sem título"}</p>
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
              statusColor(post.status),
            )}
          >
            {STATUS_LABEL[post.status]}
          </span>
        </div>

        {/* descrição */}
        {post.description && (
          <p className="line-clamp-3 text-[11px] text-muted-foreground">{post.description}</p>
        )}

        {/* hashtags */}
        {post.hashtags?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {post.hashtags.slice(0, 6).map((h) => (
              <span
                key={h}
                className="rounded-sm bg-muted px-1 py-0.5 text-[10px] text-muted-foreground"
              >
                {h}
              </span>
            ))}
            {post.hashtags.length > 6 && (
              <span className="text-[10px] text-muted-foreground">+{post.hashtags.length - 6}</span>
            )}
          </div>
        )}

        {/* fonte */}
        {post.source_url && (
          <a
            href={post.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 truncate text-[10px] text-primary hover:underline"
          >
            <ExternalLink className="size-3 shrink-0" />
            {post.source_title || post.source_url}
          </a>
        )}

        {/* plataforma + data */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="capitalize">{post.platform}</span>
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {fmtDate(post.created_at)}
          </span>
        </div>

        {/* falha */}
        {post.failure_reason && (
          <p className="rounded bg-destructive/10 px-2 py-1 text-[10px] text-destructive">
            {post.failure_reason}
          </p>
        )}

        {/* publicado */}
        {post.status === "published" && post.published_post_id && (
          <p className="text-[10px] text-green-600 dark:text-green-400">
            ID da publicação: {post.published_post_id}
          </p>
        )}

        {err && (
          <p className="rounded bg-destructive/10 px-2 py-1 text-[10px] text-destructive">{err}</p>
        )}

        {/* acções */}
        {canAct && post.status === "pending_approval" && (
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              className="h-7 flex-1 gap-1.5 text-[11px]"
              disabled={loading}
              onClick={() => void act("approve")}
            >
              {loading ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <CheckCircle2 className="size-3" />
              )}
              Aprovar e publicar
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 flex-1 gap-1.5 text-[11px]"
              disabled={loading}
              onClick={() => void act("reject")}
            >
              <XCircle className="size-3" />
              Rejeitar
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── posts tab ───────────────────────────────────────────────────────────────

function PostsTab({ token }: { token: string }) {
  const [posts, setPosts] = useState<SocialPostDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await social.getSocialPosts(token);
      setPosts(list ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao carregar posts");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
    intervalRef.current = setInterval(() => void load(), 15_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [load]);

  const generateNow = async () => {
    setGenerating(true);
    setErr(null);
    setOk(null);
    try {
      const r = await social.generateSocialNow(token);
      setOk(
        r.generated > 0
          ? `${r.generated} post(s) em geração. Aguarda aprovação via WhatsApp.`
          : "Nenhuma plataforma activa ou configuração em falta.",
      );
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao gerar");
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> A carregar posts…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {posts.length} post{posts.length !== 1 ? "s" : ""} · actualiza a cada 15s
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => void load()}
          >
            <RefreshCw className="size-3" />
            Actualizar
          </Button>
          <Button
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={generating}
            onClick={() => void generateNow()}
          >
            {generating ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Zap className="size-3" />
            )}
            Gerar agora
          </Button>
        </div>
      </div>

      {err && (
        <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{err}</p>
      )}
      {ok && (
        <p className="rounded-md bg-primary/10 p-2 text-xs text-primary">{ok}</p>
      )}

      {posts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground">
          <Share2 className="size-8 opacity-30" />
          <p>Ainda não há posts.</p>
          <p className="text-xs">Configura a automação e clica em "Gerar agora" para começar.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((p) => (
            <PostCard key={p.id} post={p} token={token} onRefresh={() => void load()} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── página principal ─────────────────────────────────────────────────────────

type Tab = "config" | "posts";

export function SocialAutomationPage() {
  const { token } = useAuth();
  const [tab, setTab] = useState<Tab>("config");

  if (!token) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
        <p>Inicie sessão para aceder à automação social.</p>
        <Link to="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Voltar
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-auto bg-background">
      {/* header */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <Link to="/" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-2")}>
          <ArrowLeft className="size-4" />
          Chat
        </Link>
        <div className="h-4 w-px bg-border" />
        <Share2 className="size-4 text-primary" />
        <h1 className="text-sm font-semibold">Automação Social</h1>
      </header>

      {/* tabs */}
      <div className="flex shrink-0 gap-1 border-b border-border px-4 pt-3">
        {(["config", "posts"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "border-b-2 px-3 pb-2 text-sm font-medium transition-colors",
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "config" ? "Configuração" : "Posts"}
          </button>
        ))}
      </div>

      {/* conteúdo */}
      <div className="mx-auto w-full max-w-3xl flex-1 p-4">
        {tab === "config" ? (
          <ConfigTab token={token} onSaved={() => setTab("posts")} />
        ) : (
          <PostsTab token={token} />
        )}
      </div>
    </div>
  );
}
