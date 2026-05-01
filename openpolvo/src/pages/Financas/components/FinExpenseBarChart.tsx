import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type CategorySpendRow = { name: string; valueMinor: number };

type Props = {
  rows: CategorySpendRow[];
  currency: string;
};

export function FinExpenseBarChart({ rows, currency }: Props) {
  const data = rows
    .filter((r) => r.valueMinor > 0)
    .map((r) => ({
      name: r.name.length > 22 ? `${r.name.slice(0, 20)}…` : r.name,
      fullName: r.name,
      value: r.valueMinor / 100,
      valueMinor: r.valueMinor,
    }))
    .slice(0, 12);

  if (data.length === 0) {
    return (
      <Card className="min-h-[200px]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Gastos por categoria</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Sem saídas categorizadas neste mês.
          </p>
        </CardContent>
      </Card>
    );
  }

  const maxW = Math.max(...data.map((d) => d.value), 0.01);

  return (
    <Card className="min-h-[240px]">
      <CardHeader className="pb-0">
        <CardTitle className="text-sm font-semibold">Gastos por categoria</CardTitle>
        <p className="text-[11px] text-muted-foreground">Saídas do mês (top 12)</p>
      </CardHeader>
      <CardContent className="h-[min(360px,calc(100vw-3rem))] min-h-[200px] pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={data}
            margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
          >
            <XAxis
              type="number"
              domain={[0, maxW * 1.08]}
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => `${Number(v).toFixed(0)}`}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={88}
              tick={{ fontSize: 10 }}
              interval={0}
            />
            <Tooltip
              formatter={(value: number) => [`${Number(value).toFixed(2)} ${currency}`, "Total"]}
              labelFormatter={(_, payload) =>
                String((payload[0]?.payload as { fullName?: string })?.fullName ?? "")
              }
            />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={22}>
              {data.map((_, i) => (
                <Cell
                  key={i}
                  fill={["#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#0ea5e9", "#14b8a6"][i % 6]}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
