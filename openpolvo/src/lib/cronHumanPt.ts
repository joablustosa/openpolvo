/** Resumo legível de expressões CRON comuns (5 campos). */
export function cronToHuman(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, , dow] = parts;
  const days: Record<string, string> = {
    "0": "dom",
    "1": "seg",
    "2": "ter",
    "3": "qua",
    "4": "qui",
    "5": "sex",
    "6": "sáb",
  };
  if (dom === "*" && dow === "*") {
    if (min === "0" && /^\d+$/.test(hour)) return `todos os dias às ${hour.padStart(2, "0")}:00`;
    if (min.startsWith("*/")) return `a cada ${min.slice(2)} minutos`;
    if (min === "0" && hour === "*") return "a cada hora";
  }
  if (dom === "*" && /^\d+$/.test(dow)) {
    const d = days[dow] || dow;
    if (min === "0" && /^\d+$/.test(hour)) return `toda ${d} às ${hour.padStart(2, "0")}:00`;
  }
  if (dom === "*" && dow.includes("-")) {
    if (min === "0" && /^\d+$/.test(hour)) return `dias úteis às ${hour.padStart(2, "0")}:00`;
  }
  return expr;
}
