import { MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { CategoryDTO, TransactionDTO } from "@/lib/financeApi";

type Props = {
  txs: TransactionDTO[];
  rootCategories: CategoryDTO[];
  onCategoryChange: (txId: string, categoryId: string | null) => void;
  onDelete: (txId: string) => void;
  patchBusyId: string | null;
};

function money(t: TransactionDTO) {
  return `${(t.amount_minor / 100).toFixed(2)} ${t.currency}`;
}

export function FinTransactionList({
  txs,
  rootCategories,
  onCategoryChange,
  onDelete,
  patchBusyId,
}: Props) {
  return (
    <>
      {/* Mobile: cards */}
      <div className="space-y-2 sm:hidden">
        {txs.map((t) => (
          <div
            key={t.id}
            className="rounded-xl border border-border bg-card p-3 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-muted-foreground">
                  {new Date(t.occurred_at).toLocaleString()}
                </p>
                <p className="mt-0.5 font-medium leading-snug">{t.description || "—"}</p>
                <p
                  className={cn(
                    "mt-1 text-base font-semibold tabular-nums",
                    t.direction === "in"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400",
                  )}
                >
                  {t.direction === "in" ? "+" : "−"}
                  {money(t)}
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger
                  nativeButton
                  render={
                    <button
                      type="button"
                      className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50"
                      aria-label="Acções"
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => onDelete(t.id)}
                  >
                    <Trash2 className="mr-2 size-3.5" />
                    Apagar
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-[10px] font-medium uppercase text-muted-foreground">
                Categoria
              </label>
              <Select
                value={t.category_id ?? "__none__"}
                disabled={patchBusyId === t.id}
                onValueChange={(v) => onCategoryChange(t.id, v === "__none__" ? null : v)}
              >
                <SelectTrigger className="h-10 min-h-[44px]">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sem categoria</SelectItem>
                  {rootCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden overflow-x-auto rounded-xl border border-border sm:block">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead className="border-b border-border bg-muted/40 text-muted-foreground">
            <tr>
              <th className="p-2.5 font-medium">Data</th>
              <th className="p-2.5 font-medium">Descrição</th>
              <th className="p-2.5 font-medium">Valor</th>
              <th className="p-2.5 font-medium">Categoria</th>
              <th className="p-2.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            {txs.map((t) => (
              <tr key={t.id} className="border-b border-border/60">
                <td className="p-2.5 whitespace-nowrap">{new Date(t.occurred_at).toLocaleString()}</td>
                <td className="p-2.5">{t.description}</td>
                <td
                  className={cn(
                    "p-2.5 whitespace-nowrap font-medium tabular-nums",
                    t.direction === "in"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400",
                  )}
                >
                  {t.direction === "in" ? "+" : "−"}
                  {money(t)}
                </td>
                <td className="p-2.5">
                  <Select
                    value={t.category_id ?? "__none__"}
                    disabled={patchBusyId === t.id}
                    onValueChange={(v) => onCategoryChange(t.id, v === "__none__" ? null : v)}
                  >
                    <SelectTrigger className="h-8 max-w-[200px]">
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">—</SelectItem>
                      {rootCategories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="p-2.5 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-destructive"
                    onClick={() => onDelete(t.id)}
                  >
                    Apagar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
