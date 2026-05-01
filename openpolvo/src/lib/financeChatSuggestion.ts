/**
 * Extrai `finance_suggestion` do texto Markdown das respostas do assistente
 * (prompt specialist_financas_pessoais).
 */

export type FinanceSuggestionPayload = {
  amount_minor: number;
  direction: "in" | "out";
  description: string;
  category_name: string;
  subcategory_name?: string;
  occurred_at: string;
};

function isDirection(v: unknown): v is "in" | "out" {
  return v === "in" || v === "out";
}

function normalizeSuggestion(raw: unknown): FinanceSuggestionPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const amount = o.amount_minor;
  const dir = o.direction;
  const desc = o.description;
  const cat = o.category_name;
  const occ = o.occurred_at;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return null;
  if (!isDirection(dir)) return null;
  if (typeof occ !== "string" || !occ.trim()) return null;
  return {
    amount_minor: Math.round(amount),
    direction: dir,
    description: typeof desc === "string" ? desc.trim() : "",
    category_name: typeof cat === "string" ? cat.trim() : "",
    subcategory_name:
      typeof o.subcategory_name === "string" ? o.subcategory_name.trim() : undefined,
    occurred_at: occ.trim(),
  };
}

function tryParseJsonBlock(inner: string): FinanceSuggestionPayload | null {
  const t = inner.trim();
  if (!t) return null;
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    if (o.finance_suggestion === null || o.finance_suggestion === undefined) {
      return null;
    }
    return normalizeSuggestion(o.finance_suggestion);
  } catch {
    return null;
  }
}

/** Procura blocos ```json e, por fim, um objecto JSON com chave finance_suggestion. */
export function parseFinanceSuggestionFromContent(
  content: string,
): FinanceSuggestionPayload | null {
  const reFence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  const blocks: string[] = [];
  while ((m = reFence.exec(content)) !== null) {
    blocks.push(m[1]);
  }
  for (let i = blocks.length - 1; i >= 0; i--) {
    const p = tryParseJsonBlock(blocks[i]);
    if (p) return p;
  }
  const tail = content.slice(Math.max(0, content.length - 4000));
  const brace = tail.lastIndexOf("{");
  if (brace === -1) return null;
  const slice = tail.slice(brace);
  for (let len = slice.length; len > 2; len--) {
    const chunk = slice.slice(0, len);
    if (!chunk.includes('"finance_suggestion"')) continue;
    const p = tryParseJsonBlock(chunk);
    if (p) return p;
  }
  return null;
}
