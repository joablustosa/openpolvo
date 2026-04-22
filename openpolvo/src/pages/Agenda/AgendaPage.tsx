import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import * as fin from "@/lib/financeApi";

function monthUtcRange(y: number, m0: number): { from: string; to: string } {
  const from = new Date(Date.UTC(y, m0, 1, 0, 0, 0));
  const to = new Date(Date.UTC(y, m0 + 1, 1, 0, 0, 0));
  return { from: from.toISOString(), to: to.toISOString() };
}

const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export function AgendaPage() {
  const { token } = useAuth();
  const now = new Date();
  const [y, setY] = useState(now.getUTCFullYear());
  const [m0, setM0] = useState(now.getUTCMonth());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [events, setEvents] = useState<fin.AgendaEventDTO[]>([]);

  const { from, to } = useMemo(() => monthUtcRange(y, m0), [y, m0]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fin.getAgenda(token, from, to);
      const ev = [...res.events].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      setEvents(ev);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao carregar agenda");
    } finally {
      setLoading(false);
    }
  }, [token, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  function prevMonth() {
    if (m0 === 0) {
      setM0(11);
      setY((v) => v - 1);
    } else {
      setM0((v) => v - 1);
    }
  }

  function nextMonth() {
    if (m0 === 11) {
      setM0(0);
      setY((v) => v + 1);
    } else {
      setM0((v) => v + 1);
    }
  }

  if (!token) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
        <p>Inicie sessão para ver a agenda.</p>
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
        <CalendarDays className="size-4 text-primary" />
        <h1 className="text-sm font-semibold">Agenda</h1>
      </header>

      <div className="mx-auto w-full max-w-3xl flex-1 space-y-4 p-4">
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" size="sm" className="gap-1" onClick={prevMonth}>
            <ChevronLeft className="size-4" />
          </Button>
          <p className="text-sm font-medium">
            {MONTH_NAMES[m0]} {y}
          </p>
          <Button type="button" variant="outline" size="sm" className="gap-1" onClick={nextMonth}>
            <ChevronRight className="size-4" />
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> A carregar…
          </div>
        ) : null}
        {err ? (
          <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{err}</p>
        ) : null}

        <ul className="space-y-2">
          {events.length === 0 && !loading ? (
            <p className="text-xs text-muted-foreground">Sem eventos neste mês.</p>
          ) : null}
          {events.map((e) => (
            <li
              key={`${e.type}-${e.id}`}
              className={cn(
                "rounded-lg border border-border bg-card px-3 py-2 text-sm",
                e.type === "task" && "border-l-4 border-l-sky-500",
                e.type === "transaction" && "border-l-4 border-l-emerald-600",
                e.type === "subscription" && "border-l-4 border-l-amber-500",
              )}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{e.title}</span>
                <span className="text-[11px] uppercase text-muted-foreground">{e.type}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {new Date(e.starts_at).toLocaleString(undefined, {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
