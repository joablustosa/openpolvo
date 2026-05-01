/** Extensão → linguagem Monaco (aproximação VS Code). */
export function detectLanguage(relPath: string): string {
  const base = relPath.split("/").pop() ?? relPath;
  const ext = base.includes(".") ? base.split(".").pop()?.toLowerCase() ?? "" : "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    mts: "typescript",
    cts: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    css: "css",
    scss: "scss",
    sass: "scss",
    less: "less",
    html: "html",
    htm: "html",
    vue: "html",
    md: "markdown",
    mdx: "markdown",
    yaml: "yaml",
    yml: "yaml",
    rs: "rust",
    go: "go",
    py: "python",
    sql: "sql",
    xml: "xml",
    svg: "xml",
    toml: "plaintext",
    env: "plaintext",
    gitignore: "plaintext",
  };
  return map[ext] ?? "plaintext";
}
