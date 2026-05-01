import { ArrowDownLeft, ArrowUpRight, Scale } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Props = {
  totalInMinor: number;
  totalOutMinor: number;
  currency: string;
  className?: string;
};

function fmt(minor: number, currency: string) {
  const v = (minor / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${v} ${currency}`;
}

export function FinSummaryStrip({ totalInMinor, totalOutMinor, currency, className }: Props) {
  const net = totalInMinor - totalOutMinor;
  return (
    <div
      className={cn(
        "grid gap-3 sm:grid-cols-3",
        className,
      )}
    >
      <Card className="border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 to-transparent ring-emerald-500/15">
        <CardContent className="flex items-center gap-3 px-4 py-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
            <ArrowDownLeft className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Entradas
            </p>
            <p className="truncate text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
              +{fmt(totalInMinor, currency)}
            </p>
          </div>
        </CardContent>
      </Card>
      <Card className="border-rose-500/20 bg-gradient-to-br from-rose-500/10 to-transparent ring-rose-500/15">
        <CardContent className="flex items-center gap-3 px-4 py-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-700 dark:text-rose-400">
            <ArrowUpRight className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Saídas
            </p>
            <p className="truncate text-lg font-semibold tabular-nums text-rose-700 dark:text-rose-400">
              −{fmt(totalOutMinor, currency)}
            </p>
          </div>
        </CardContent>
      </Card>
      <Card className="border-primary/25 bg-gradient-to-br from-primary/10 to-transparent ring-primary/20 sm:col-span-1">
        <CardContent className="flex items-center gap-3 px-4 py-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Scale className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Saldo do período
            </p>
            <p
              className={cn(
                "truncate text-lg font-semibold tabular-nums",
                net >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400",
              )}
            >
              {net >= 0 ? "+" : ""}
              {fmt(net, currency)}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
