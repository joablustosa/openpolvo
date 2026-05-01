import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

/** Configuração única dos workers do Monaco para Vite (crossOriginIsolated). */
export function configureMonacoWorkers(): void {
  const g = globalThis as unknown as {
    MonacoEnvironment?: { getWorker: (moduleId: string, label: string) => Worker };
  };
  if (g.MonacoEnvironment?.getWorker) return;

  g.MonacoEnvironment = {
    getWorker(_moduleId: string, label: string) {
      switch (label) {
        case "json":
          return new jsonWorker();
        case "css":
        case "scss":
        case "less":
          return new cssWorker();
        case "html":
        case "handlebars":
        case "razor":
          return new htmlWorker();
        case "typescript":
        case "javascript":
          return new tsWorker();
        default:
          return new editorWorker();
      }
    },
  };

  monaco.editor.defineTheme("polvo-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#1e1e1e",
      "editorLineNumber.foreground": "#858585",
      "editorCursor.foreground": "#aeafad",
      focusBorder: "#007fd4",
      "sideBar.background": "#252526",
      "panel.background": "#1e1e1e",
      "panel.border": "#474747",
    },
  });
}
