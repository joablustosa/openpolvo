import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CategoryDTO } from "@/lib/financeApi";

type Props = {
  rootCategories: CategoryDTO[];
  txAmount: string;
  setTxAmount: (v: string) => void;
  txDir: "in" | "out";
  setTxDir: (v: "in" | "out") => void;
  txWhen: string;
  setTxWhen: (v: string) => void;
  txCat: string;
  setTxCat: (v: string) => void;
  txDesc: string;
  setTxDesc: (v: string) => void;
  onSubmit: () => void;
  submitLabel?: string;
};

export function FinTransactionFormFields({
  rootCategories,
  txAmount,
  setTxAmount,
  txDir,
  setTxDir,
  txWhen,
  setTxWhen,
  txCat,
  setTxCat,
  txDesc,
  setTxDesc,
  onSubmit,
  submitLabel = "Adicionar transacção",
}: Props) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-muted-foreground">Valor (€)</label>
        <Input value={txAmount} onChange={(e) => setTxAmount(e.target.value)} placeholder="12,50" />
      </div>
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-muted-foreground">Sentido</label>
        <Select value={txDir} onValueChange={(v) => setTxDir(v as "in" | "out")}>
          <SelectTrigger className="h-10 min-h-[44px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="out">Saída</SelectItem>
            <SelectItem value="in">Entrada</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1 sm:col-span-2">
        <label className="text-[11px] font-medium text-muted-foreground">Data e hora</label>
        <Input
          type="datetime-local"
          className="min-h-[44px]"
          value={txWhen}
          onChange={(e) => setTxWhen(e.target.value)}
        />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <label className="text-[11px] font-medium text-muted-foreground">Categoria (opcional)</label>
        <Select value={txCat || "__none__"} onValueChange={(v) => setTxCat(v === "__none__" ? "" : v)}>
          <SelectTrigger className="h-10 min-h-[44px]">
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
      </div>
      <div className="space-y-1 sm:col-span-2 lg:col-span-4">
        <label className="text-[11px] font-medium text-muted-foreground">Descrição</label>
        <Input value={txDesc} onChange={(e) => setTxDesc(e.target.value)} placeholder="Supermercado" />
      </div>
      <Button type="button" className="min-h-[44px] w-full sm:w-auto" onClick={() => onSubmit()}>
        {submitLabel}
      </Button>
    </div>
  );
}
