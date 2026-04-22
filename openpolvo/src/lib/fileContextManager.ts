/**
 * FileContextManager — contexto incremental para o agente de vibe-coding.
 *
 * Permite ao LLM fazer edições cirúrgicas enviando apenas os ficheiros alterados,
 * em vez do projecto inteiro a cada turno. O gestor mantém um snapshot dos ficheiros
 * actuais, calcula diffs, constrói prompts mínimos e aplica patches parciais.
 */

// ─── Tipos públicos ────────────────────────────────────────────────────────────

/** Mapa caminho→conteúdo (string vazia ou ausente = ficheiro apagado). */
export type FileMap = Record<string, string>;

export interface FileContextManager {
  /** Regista o estado completo actual dos ficheiros. */
  snapshot(files: FileMap): void;

  /** Devolve só os ficheiros que mudaram desde o último snapshot. */
  diff(): FileMap;

  /**
   * Constrói um prompt mínimo para o LLM com apenas o contexto necessário.
   * @param userInstruction — instrução do utilizador em linguagem natural
   * @param relevantFiles   — lista de caminhos a incluir; se omitida, selecção automática
   */
  buildPatchPrompt(userInstruction: string, relevantFiles?: string[]): string;

  /**
   * Aplica o patch devolvido pelo LLM sem substituir ficheiros não mencionados.
   * Conteúdo vazio ou `null` → ficheiro apagado.
   */
  applyPatch(patch: FileMap): void;

  /** Retorna uma cópia do estado actual de todos os ficheiros. */
  getFiles(): FileMap;

  /** Retorna a árvore de ficheiros como string indentada. */
  getFileTree(): string;
}

// ─── Implementação ─────────────────────────────────────────────────────────────

export class FileContextManagerImpl implements FileContextManager {
  private _current: FileMap = {};
  private _lastSnapshot: FileMap = {};
  private _tree = "";

  snapshot(files: FileMap): void {
    this._current = { ...files };
    this._lastSnapshot = { ...files };
    this._tree = buildTree(Object.keys(files));
  }

  diff(): FileMap {
    const changed: FileMap = {};

    for (const [path, content] of Object.entries(this._current)) {
      if (this._lastSnapshot[path] !== content) {
        changed[path] = content;
      }
    }

    for (const path of Object.keys(this._lastSnapshot)) {
      if (!(path in this._current)) {
        changed[path] = ""; // sinaliza remoção
      }
    }

    return changed;
  }

  buildPatchPrompt(userInstruction: string, relevantFiles?: string[]): string {
    const toInclude = relevantFiles
      ? relevantFiles.filter((f) => f in this._current)
      : selectRelevant(userInstruction, this._current);

    const fileBlocks = toInclude
      .map((path) => {
        const ext = path.split(".").pop() ?? "";
        const fence = "```" + ext;
        return `### ${path}\n${fence}\n${this._current[path] ?? ""}\n\`\`\``;
      })
      .join("\n\n");

    const includedList = toInclude.map((f) => `  - ${f}`).join("\n");
    const totalFiles = Object.keys(this._current).length;

    return `## Contexto do projecto

Estrutura de ficheiros (${totalFiles} ficheiros no total):
\`\`\`
${this._tree}
\`\`\`

Ficheiros incluídos neste prompt (${toInclude.length} de ${totalFiles}):
${includedList || "  (nenhum detectado automaticamente — inclui os que precisares)"}

## Ficheiros relevantes

${fileBlocks || "(nenhum ficheiro seleccionado)"}

## Instrução do utilizador

${userInstruction}

## Formato de resposta obrigatório

Responde EXCLUSIVAMENTE com um bloco JSON com os ficheiros a alterar:

\`\`\`json
{
  "caminho/relativo/ficheiro.tsx": "conteúdo completo e funcional do ficheiro",
  "outro/ficheiro.ts": "conteúdo completo"
}
\`\`\`

Regras:
- Inclui APENAS os ficheiros que precisam de alteração
- Cada ficheiro deve estar COMPLETO (não truncado, sem "...")
- Para apagar um ficheiro, usa string vazia: \`"path": ""\`
- Não reescreves ficheiros que não precisam de mudança
- Não adiciones explicações fora do bloco JSON`;
  }

  applyPatch(patch: FileMap): void {
    for (const [path, content] of Object.entries(patch)) {
      if (content === "" || content === null || content === undefined) {
        delete this._current[path];
      } else {
        this._current[path] = content;
      }
    }
    this._tree = buildTree(Object.keys(this._current));
  }

  getFiles(): FileMap {
    return { ...this._current };
  }

  getFileTree(): string {
    return this._tree;
  }
}

// ─── Factory ───────────────────────────────────────────────────────────────────

export function createFileContextManager(): FileContextManager {
  return new FileContextManagerImpl();
}

// ─── Utilitários internos ──────────────────────────────────────────────────────

function buildTree(paths: string[]): string {
  const sorted = [...paths].sort();
  const lines: string[] = [];

  for (const path of sorted) {
    const parts = path.split("/").filter(Boolean);
    const depth = parts.length - 1;
    const name = parts[parts.length - 1] ?? path;
    lines.push("  ".repeat(depth) + name);
  }

  return lines.join("\n");
}

/** Heurística: selecciona os ficheiros mais prováveis de precisar edição. */
function selectRelevant(instruction: string, files: FileMap): string[] {
  const lower = instruction.toLowerCase();
  const all = Object.keys(files);

  const scored: Array<{ path: string; score: number }> = all.map((path) => {
    let score = 0;
    const name = (path.split("/").pop() ?? "").toLowerCase();
    const nameStem = name.split(".")[0] ?? "";
    const ext = name.split(".").pop() ?? "";

    // Ficheiro mencionado por nome na instrução
    if (nameStem && lower.includes(nameStem)) score += 10;

    // Entry points têm prioridade alta
    if (["main.tsx", "main.jsx", "app.tsx", "index.tsx"].includes(name)) score += 6;

    // Correspondência por extensão e tema da instrução
    if (["tsx", "jsx"].includes(ext)) {
      if (hasAny(lower, ["component", "ui", "button", "modal", "form", "layout", "page"])) {
        score += 4;
      }
    }
    if (ext === "css" || ext === "scss") {
      if (hasAny(lower, ["style", "css", "color", "theme", "design", "layout"])) score += 5;
    }
    if (name === "package.json") {
      if (hasAny(lower, ["depend", "package", "install", "librar", "version"])) score += 5;
    }
    if (hasAny(name, ["route", "router", "page"])) {
      if (hasAny(lower, ["route", "page", "navigate", "link"])) score += 5;
    }
    if (hasAny(nameStem, ["api", "service", "hook", "util", "lib"])) {
      if (hasAny(lower, ["api", "fetch", "request", "service", "hook", "logic"])) score += 4;
    }

    // Profundidade: ficheiros de raiz e src/ têm vantagem
    const depth = path.split("/").length;
    if (depth <= 2) score += 2;
    else if (depth <= 3) score += 1;

    return { path, score };
  });

  const filtered = scored.filter((s) => s.score > 0);
  filtered.sort((a, b) => b.score - a.score);

  // Máximo de 15 ficheiros para não inflar o contexto
  const selected = filtered.slice(0, 15).map((s) => s.path);

  // Fallback: ficheiros de raiz e src/
  if (selected.length === 0) {
    return all
      .filter((p) => p.split("/").length <= 3)
      .sort()
      .slice(0, 10);
  }

  return selected;
}

function hasAny(text: string, keywords: string[]): boolean {
  return keywords.some((k) => text.includes(k));
}
