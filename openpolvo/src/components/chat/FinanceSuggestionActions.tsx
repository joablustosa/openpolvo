import { useState } from "react";
import { Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import * as fin from "@/lib/financeApi";
import type { FinanceSuggestionPayload } from "@/lib/financeChatSuggestion";

type Props = {
  token: string;
  suggestion: FinanceSuggestionPayload;
  onRecorded?: () => void;
};

function findCategoryByName(
  categories: fin.CategoryDTO[],
  name: string,
): fin.CategoryDTO | undefined {
  const n = name.trim().toLowerCase();
  if (!n) return undefined;
  return categories.find((c) => c.name.trim().toLowerCase() === n);
}

export function FinanceSuggestionActions({ token, suggestion, onRecorded }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">
        Transacção registada nas finanças.
      </div>
    );
  }

  const euros = (suggestion.amount_minor / 100).toFixed(2);
  const when = (() => {
    try {
      return new Date(suggestion.occurred_at).toLocaleString();
    } catch {
      return suggestion.occurred_at;
    }
  })();

  async function record() {
    setBusy(true);
    setErr(null);
    try {
      let categories = await fin.getCategories(token);
      let cat = findCategoryByName(categories, suggestion.category_name);
      if (!cat && suggestion.category_name.trim()) {
        cat = await fin.postCategory(token, {
          name: suggestion.category_name.trim(),
          sort_order: 0,
        });
        categories = [...categories, cat];
      }
      let occurred: string;
      try {
        occurred = new Date(suggestion.occurred_at).toISOString();
      } catch {
        setErr("Data inválida na sugestão.");
        return;
      }
      await fin.postTransaction(token, {
        amount_minor: suggestion.amount_minor,
        direction: suggestion.direction,
        occurred_at: occurred,
        description: suggestion.description || suggestion.category_name || "Transacção",
        category_id: cat?.id ?? null,
        source: "manual",
      });
      setDone(true);
      onRecorded?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao registar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Wallet className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1 text-xs">
          <p className="font-medium text-foreground">Sugestão de registo</p>
          <p className="mt-1 text-muted-foreground">
            {suggestion.direction === "out" ? "Saída" : "Entrada"} · {euros} € · {when}
          </p>
          {suggestion.description ? (
            <p className="mt-0.5 truncate text-foreground/90">{suggestion.description}</p>
          ) : null}
          {suggestion.category_name ? (
            <p className="mt-0.5 text-muted-foreground">
              Categoria: {suggestion.category_name}
            </p>
          ) : null}
        </div>
      </div>
      {err ? <p className="text-xs text-destructive">{err}</p> : null}
      <Button
        type="button"
        size="sm"
        className="w-full gap-1.5"
        disabled={busy}
        onClick={() => void record()}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
        Registar nas finanças
      </Button>
    </div>
  );
}
