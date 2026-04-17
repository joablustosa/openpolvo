import { useState } from "react";
import { Highlight, themes } from "prism-react-renderer";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  code: string;
  language: string;
  /** Nome do ficheiro a mostrar no topo (opcional). */
  filename?: string;
  className?: string;
};

/** Mapeia extensões/ids para a linguagem que o Prism entende. */
function normalizeLanguage(l: string): string {
  const x = l.toLowerCase();
  if (x === "ts") return "typescript";
  if (x === "js") return "javascript";
  if (x === "md") return "markdown";
  if (x === "yml") return "yaml";
  if (x === "sh" || x === "bash" || x === "shell") return "bash";
  return x || "text";
}

export function CodeBlock({ code, language, filename, className }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // noop
    }
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col overflow-hidden", className)}>
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/30 px-3">
        <span className="truncate font-mono text-xs text-muted-foreground">
          {filename ?? ""}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          aria-label="Copiar código"
          className="h-7 gap-1.5 px-2 text-xs"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>
      <div className="relative flex-1 min-h-0 overflow-auto bg-[var(--code-bg,theme(colors.zinc.950))] text-sm">
        <Highlight code={code} language={normalizeLanguage(language)} theme={themes.vsDark}>
          {({ className: cn2, style, tokens, getLineProps, getTokenProps }) => (
            <pre
              className={cn(cn2, "m-0 min-w-full p-4 font-mono text-xs leading-relaxed")}
              style={{ ...style, background: "transparent" }}
            >
              {tokens.map((line, i) => {
                const lineProps = getLineProps({ line });
                const { key: _lineKey, ...lineRest } = lineProps;
                return (
                  <div key={i} {...lineRest} className={cn(lineProps.className, "table-row")}>
                    <span className="table-cell select-none pr-4 text-right text-zinc-600">
                      {i + 1}
                    </span>
                    <span className="table-cell whitespace-pre-wrap break-all">
                      {line.map((token, j) => {
                        const tokenProps = getTokenProps({ token });
                        const { key: _tkKey, ...tokenRest } = tokenProps;
                        return <span key={j} {...tokenRest} />;
                      })}
                    </span>
                  </div>
                );
              })}
            </pre>
          )}
        </Highlight>
      </div>
    </div>
  );
}
