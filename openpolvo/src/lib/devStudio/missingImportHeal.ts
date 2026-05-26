import type { DevStudioOp } from "@/lib/devStudioMetadata";

const MISSING_IMPORT_RE =
  /Failed to resolve import\s+"(?<spec>[^"]+)"\s+from\s+"(?<from>[^"]+)"/i;

function isComponentsAliasImport(spec: string): boolean {
  return spec.startsWith("@/components/") && !spec.includes("/layout/");
}

function componentFilePathFromSpec(spec: string): string | null {
  // "@/components/Hero" → "src/components/Hero.tsx"
  const rel = spec.replace(/^@\//, "src/").replace(/^\/*/, "");
  if (!rel.startsWith("src/components/")) return null;
  if (/\.(tsx|ts|jsx|js)$/.test(rel)) return rel;
  return `${rel}.tsx`;
}

function pascalToWords(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").trim();
}

function componentNameFromPath(path: string): string {
  const base = path.split("/").pop() || "Component";
  return base.replace(/\.(tsx|ts|jsx|js)$/, "") || "Component";
}

function buildStubComponentTsx(path: string): string {
  const name = componentNameFromPath(path);
  const label = pascalToWords(name);

  // Stub simples, shadcn-friendly, sem dependências externas.
  if (name.toLowerCase().includes("footer")) {
    return `export default function ${name}() {
  return (
    <footer className="border-t border-border bg-background px-6 py-10">
      <div className="mx-auto max-w-6xl text-sm text-muted-foreground">
        <p>${label} (placeholder)</p>
      </div>
    </footer>
  )
}
`;
  }

  return `import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function ${name}() {
  return (
    <section className="border-b border-border bg-background px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <Card>
          <CardHeader>
            <CardTitle>${label}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Secção placeholder criada automaticamente para resolver um import em falta.
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
`;
}

/**
 * Self-heal determinístico: cria ficheiro(s) em falta para imports tipo "@/components/X".
 * Não tenta “adivinhar” implementação; cria placeholders válidos para o Vite compilar.
 */
export function buildMissingImportHealOps(compileLog: string): DevStudioOp[] | null {
  const m = compileLog.match(MISSING_IMPORT_RE);
  const spec = (m?.groups?.spec || "").trim();
  if (!spec || !isComponentsAliasImport(spec)) return null;

  const path = componentFilePathFromSpec(spec);
  if (!path) return null;

  return [
    {
      op: "write",
      path,
      content: buildStubComponentTsx(path),
    },
  ];
}

