import * as React from "react";
import * as RechartsPrimitive from "recharts";
import { cn } from "@/lib/utils";

// Paleta de cores padrão para os gráficos
export const CHART_COLORS = [
  "hsl(var(--chart-1, 262 83% 58%))",
  "hsl(var(--chart-2, 197 73% 49%))",
  "hsl(var(--chart-3, 142 69% 44%))",
  "hsl(var(--chart-4, 36 97% 55%))",
  "hsl(var(--chart-5, 0 72% 54%))",
] as const;

export const CHART_COLOR_VARS = [
  "var(--color-chart-1, #7c3aed)",
  "var(--color-chart-2, #0ea5e9)",
  "var(--color-chart-3, #22c55e)",
  "var(--color-chart-4, #f59e0b)",
  "var(--color-chart-5, #ef4444)",
] as const;

// ─── Tooltip customizado ────────────────────────────────────────────────────

type ChartTooltipProps = {
  active?: boolean;
  payload?: Array<{ name: string; value: number | string; color?: string }>;
  label?: string;
  labelFormatter?: (label: string) => string;
  formatter?: (value: number | string, name: string) => [string, string];
};

export function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  formatter,
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  const displayLabel = labelFormatter ? labelFormatter(String(label ?? "")) : label;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-md text-sm">
      {displayLabel ? (
        <p className="mb-1 font-medium text-foreground">{displayLabel}</p>
      ) : null}
      {payload.map((entry, i) => {
        const [val, name] = formatter
          ? formatter(entry.value, entry.name)
          : [String(entry.value), entry.name];
        return (
          <div key={i} className="flex items-center gap-2">
            <span
              className="inline-block size-2.5 shrink-0 rounded-sm"
              style={{ background: entry.color ?? CHART_COLOR_VARS[i % CHART_COLOR_VARS.length] }}
            />
            <span className="text-muted-foreground">{name}:</span>
            <span className="font-medium text-foreground">{val}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Legend customizado ────────────────────────────────────────────────────

type LegendPayloadItem = {
  value: string;
  color?: string;
  type?: string;
};

type ChartLegendProps = {
  payload?: LegendPayloadItem[];
  className?: string;
};

export function ChartLegendContent({ payload, className }: ChartLegendProps) {
  if (!payload?.length) return null;
  return (
    <ul className={cn("flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs", className)}>
      {payload.map((entry, i) => (
        <li key={i} className="flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 shrink-0 rounded-sm"
            style={{ background: entry.color ?? CHART_COLOR_VARS[i % CHART_COLOR_VARS.length] }}
          />
          <span className="text-muted-foreground">{entry.value}</span>
        </li>
      ))}
    </ul>
  );
}

// ─── Container responsivo ──────────────────────────────────────────────────

type ChartContainerProps = {
  children: React.ReactNode;
  className?: string;
  minHeight?: number;
};

export function ChartContainer({ children, className, minHeight = 220 }: ChartContainerProps) {
  return (
    <div
      className={cn("w-full", className)}
      style={{ minHeight }}
    >
      <RechartsPrimitive.ResponsiveContainer width="100%" height={minHeight}>
        {children as React.ReactElement}
      </RechartsPrimitive.ResponsiveContainer>
    </div>
  );
}

// Re-export dos primitivos mais usados para conveniência
export const {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} = RechartsPrimitive;
