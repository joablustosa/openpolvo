import { useState, useMemo } from "react";
import { X, BarChart2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChartContainer,
  ChartTooltipContent,
  ChartLegendContent,
  CHART_COLOR_VARS,
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
} from "@/components/ui/chart";
import type { DashboardData, DashboardChart, DashboardFilter } from "@/lib/dashboardMetadata";
import { cn } from "@/lib/utils";

type Props = {
  data: DashboardData;
  onClose: () => void;
};

// ─── Filtro select ──────────────────────────────────────────────────────────

type FilterBarProps = {
  filters: DashboardFilter[];
  values: Record<string, string>;
  onChange: (id: string, value: string | null) => void;
};

function FilterBar({ filters, values, onChange }: FilterBarProps) {
  if (!filters.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-muted/20">
      {filters.map((f) => (
        <div key={f.id} className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground shrink-0">{f.label}:</span>
          {f.type === "select" && f.options ? (
            <Select
              value={values[f.id] ?? f.default ?? f.options[0] ?? ""}
              onValueChange={(v) => onChange(f.id, v)}
            >
              <SelectTrigger className="h-7 text-xs min-w-[120px] border-border/60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {f.options.map((opt) => (
                  <SelectItem key={opt} value={opt} className="text-xs">
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ─── Gráfico individual ─────────────────────────────────────────────────────

type SingleChartProps = {
  chart: DashboardChart;
  filterValues: Record<string, string>;
};

function SingleChart({ chart, filterValues: _filterValues }: SingleChartProps) {
  const { type, data, xKey, dataKeys, dataLabels, color, unit } = chart;

  const colors = dataKeys.map((_, i) =>
    i === 0 && color ? color : CHART_COLOR_VARS[i % CHART_COLOR_VARS.length],
  );

  const tooltipFormatter = (value: number | string, name: string) => {
    const label = name;
    const val = unit ? `${value} ${unit}` : String(value);
    return [val, label] as [string, string];
  };

  if (type === "bar") {
    return (
      <ChartContainer minHeight={220}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey={xKey} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
          <Tooltip content={<ChartTooltipContent formatter={tooltipFormatter} />} />
          {dataKeys.length > 1 && (
            <Legend
              content={
                <ChartLegendContent
                  payload={dataKeys.map((k, i) => ({
                    value: dataLabels?.[i] ?? k,
                    color: colors[i],
                  }))}
                />
              }
            />
          )}
          {dataKeys.map((k, i) => (
            <Bar key={k} dataKey={k} name={dataLabels?.[i] ?? k} fill={colors[i]} radius={[3, 3, 0, 0]} />
          ))}
        </BarChart>
      </ChartContainer>
    );
  }

  if (type === "line") {
    return (
      <ChartContainer minHeight={220}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey={xKey} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
          <Tooltip content={<ChartTooltipContent formatter={tooltipFormatter} />} />
          {dataKeys.length > 1 && (
            <Legend
              content={
                <ChartLegendContent
                  payload={dataKeys.map((k, i) => ({
                    value: dataLabels?.[i] ?? k,
                    color: colors[i],
                  }))}
                />
              }
            />
          )}
          {dataKeys.map((k, i) => (
            <Line
              key={k}
              type="monotone"
              dataKey={k}
              name={dataLabels?.[i] ?? k}
              stroke={colors[i]}
              strokeWidth={2}
              dot={{ r: 3, fill: colors[i] }}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      </ChartContainer>
    );
  }

  if (type === "area") {
    return (
      <ChartContainer minHeight={220}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <defs>
            {dataKeys.map((k, i) => (
              <linearGradient key={k} id={`grad-${chart.id}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors[i]} stopOpacity={0.3} />
                <stop offset="95%" stopColor={colors[i]} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey={xKey} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
          <Tooltip content={<ChartTooltipContent formatter={tooltipFormatter} />} />
          {dataKeys.length > 1 && (
            <Legend
              content={
                <ChartLegendContent
                  payload={dataKeys.map((k, i) => ({
                    value: dataLabels?.[i] ?? k,
                    color: colors[i],
                  }))}
                />
              }
            />
          )}
          {dataKeys.map((k, i) => (
            <Area
              key={k}
              type="monotone"
              dataKey={k}
              name={dataLabels?.[i] ?? k}
              stroke={colors[i]}
              strokeWidth={2}
              fill={`url(#grad-${chart.id}-${i})`}
            />
          ))}
        </AreaChart>
      </ChartContainer>
    );
  }

  if (type === "pie") {
    const pieKey = dataKeys[0] ?? "value";
    return (
      <ChartContainer minHeight={220}>
        <PieChart margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
          <Tooltip content={<ChartTooltipContent formatter={tooltipFormatter} />} />
          <Legend
            content={
              <ChartLegendContent
                payload={data.map((row, i) => ({
                  value: String(row[xKey] ?? i),
                  color: CHART_COLOR_VARS[i % CHART_COLOR_VARS.length],
                }))}
              />
            }
          />
          <Pie
            data={data}
            dataKey={pieKey}
            nameKey={xKey}
            cx="50%"
            cy="45%"
            outerRadius={80}
            paddingAngle={2}
          >
            {data.map((_row, i) => (
              <Cell key={i} fill={CHART_COLOR_VARS[i % CHART_COLOR_VARS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
    );
  }

  if (type === "radar") {
    const radarKey = dataKeys[0] ?? "value";
    return (
      <ChartContainer minHeight={220}>
        <RadarChart cx="50%" cy="50%" outerRadius={80} data={data}>
          <PolarGrid stroke="hsl(var(--border))" />
          <PolarAngleAxis dataKey={xKey} tick={{ fontSize: 11 }} />
          <PolarRadiusAxis tick={{ fontSize: 10 }} />
          <Tooltip content={<ChartTooltipContent formatter={tooltipFormatter} />} />
          <Radar
            dataKey={radarKey}
            name={dataLabels?.[0] ?? radarKey}
            stroke={colors[0]}
            fill={colors[0]}
            fillOpacity={0.25}
          />
        </RadarChart>
      </ChartContainer>
    );
  }

  return null;
}

// ─── Card de gráfico ────────────────────────────────────────────────────────

type ChartCardProps = {
  chart: DashboardChart;
  filterValues: Record<string, string>;
};

function ChartCard({ chart, filterValues }: ChartCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold tracking-tight text-card-foreground">
        {chart.title}
      </h3>
      <SingleChart chart={chart} filterValues={filterValues} />
    </div>
  );
}

// ─── Painel principal ───────────────────────────────────────────────────────

export function DashboardPanel({ data, onClose }: Props) {
  const { title, description, charts, filters = [] } = data;

  const initialFilterValues = useMemo(() => {
    const init: Record<string, string> = {};
    for (const f of filters) {
      init[f.id] = f.default ?? f.options?.[0] ?? "";
    }
    return init;
  }, [filters]);

  const [filterValues, setFilterValues] =
    useState<Record<string, string>>(initialFilterValues);

  function handleFilterChange(id: string, value: string | null) {
    if (value == null) return;
    setFilterValues((prev) => ({ ...prev, [id]: value }));
  }

  const gridClass = cn(
    "grid gap-4 p-4",
    charts.length === 1 ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2",
  );

  return (
    <section
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-muted/30"
      aria-label="Dashboard de análise"
    >
      {/* Cabeçalho */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-card/60 px-3">
        <BarChart2 className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{title}</span>
        {description ? (
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            {description}
          </span>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="ml-auto shrink-0"
          onClick={onClose}
          title="Fechar dashboard"
          aria-label="Fechar dashboard"
        >
          <X className="size-4" />
        </Button>
      </header>

      {/* Barra de filtros */}
      <FilterBar
        filters={filters}
        values={filterValues}
        onChange={handleFilterChange}
      />

      {/* Gráficos */}
      <ScrollArea className="flex-1 min-h-0">
        <div className={gridClass}>
          {charts.map((chart) => (
            <ChartCard key={chart.id} chart={chart} filterValues={filterValues} />
          ))}
        </div>
      </ScrollArea>
    </section>
  );
}
