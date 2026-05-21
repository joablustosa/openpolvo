import type { CodeApplicationPhase } from "./types";

export function phaseLabel(phase: CodeApplicationPhase): string {
  switch (phase) {
    case "applying":
      return "A aplicar ficheiros…";
    case "installing":
      return "npm install…";
    case "dev_starting":
      return "A arrancar o servidor de desenvolvimento…";
    case "complete":
      return "Pronto.";
    case "error":
      return "Erro na aplicação.";
    default:
      return "";
  }
}
