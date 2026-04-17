/**
 * Tipos e parser para o payload `dashboard` retornado pelo agente Python
 * na metadata da mensagem do assistente (intenção `analise_dados_relatorios`).
 */

export type ChartType = "bar" | "line" | "area" | "pie" | "radar";

export type ChartDataRow = Record<string, string | number>;

export type DashboardChart = {
  id: string;
  type: ChartType;
  title: string;
  /** Chave do eixo X (categorias) */
  xKey: string;
  /** Uma ou mais chaves de valores para plotar */
  dataKeys: string[];
  /** Labels exibidos na legenda (índice corresponde a dataKeys) */
  dataLabels?: string[];
  /** Dados brutos */
  data: ChartDataRow[];
  /** Cor principal (CSS color). Opcional — usa paleta padrão se omitido. */
  color?: string;
  /** Unidade exibida no tooltip (ex: "R$", "%", "un.") */
  unit?: string;
};

export type DashboardFilter = {
  id: string;
  label: string;
  type: "select" | "range";
  options?: string[];
  default?: string;
};

export type DashboardData = {
  title: string;
  description?: string;
  charts: DashboardChart[];
  filters?: DashboardFilter[];
};

function parseMetaObj(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function isChartRow(v: unknown): v is ChartDataRow {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseChart(raw: unknown): DashboardChart | null {
  const c = parseMetaObj(raw);
  if (!c) return null;
  const id = typeof c.id === "string" ? c.id : String(Math.random());
  const type: ChartType = ["bar", "line", "area", "pie", "radar"].includes(
    String(c.type),
  )
    ? (c.type as ChartType)
    : "bar";
  const title = typeof c.title === "string" ? c.title : "Gráfico";
  const xKey = typeof c.xKey === "string" ? c.xKey : "x";
  const dataKeys = Array.isArray(c.dataKeys)
    ? (c.dataKeys as unknown[]).filter((k) => typeof k === "string") as string[]
    : typeof c.dataKey === "string"
      ? [c.dataKey]
      : ["value"];
  const dataLabels = Array.isArray(c.dataLabels)
    ? (c.dataLabels as unknown[]).map(String)
    : undefined;
  const data = Array.isArray(c.data)
    ? (c.data as unknown[]).filter(isChartRow)
    : [];
  const color = typeof c.color === "string" ? c.color : undefined;
  const unit = typeof c.unit === "string" ? c.unit : undefined;
  return { id, type, title, xKey, dataKeys, dataLabels, data, color, unit };
}

function parseFilter(raw: unknown): DashboardFilter | null {
  const f = parseMetaObj(raw);
  if (!f) return null;
  return {
    id: typeof f.id === "string" ? f.id : String(Math.random()),
    label: typeof f.label === "string" ? f.label : "Filtro",
    type: f.type === "range" ? "range" : "select",
    options: Array.isArray(f.options)
      ? (f.options as unknown[]).map(String)
      : undefined,
    default: typeof f.default === "string" ? f.default : undefined,
  };
}

/** Extrai `dashboard` da metadata de uma mensagem do assistente. */
export function parseDashboardMeta(metadata: unknown): DashboardData | null {
  const meta = parseMetaObj(metadata);
  if (!meta) return null;
  const raw = parseMetaObj(meta.dashboard);
  if (!raw) return null;

  const title = typeof raw.title === "string" ? raw.title : "Dashboard";
  const description =
    typeof raw.description === "string" ? raw.description : undefined;
  const charts = Array.isArray(raw.charts)
    ? (raw.charts as unknown[]).map(parseChart).filter(Boolean) as DashboardChart[]
    : [];
  const filters = Array.isArray(raw.filters)
    ? (raw.filters as unknown[]).map(parseFilter).filter(Boolean) as DashboardFilter[]
    : [];

  if (charts.length === 0) return null;
  return { title, description, charts, filters };
}
