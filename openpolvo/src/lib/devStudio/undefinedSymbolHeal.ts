/**
 * Correcções rápidas para ReferenceError: X is not defined (sem LLM).
 */

import type { DevStudioOp } from "@/lib/devStudioMetadata";

const UNDEFINED_SYM_RE =
  /ReferenceError:\s*([A-Za-z_$][\w$]*)\s+is not defined/i;

const STACK_FILE_RE =
  /(?:at\s+\w+\s+\([^)]*\/(src\/[\w./-]+\.tsx?)|\((src\/[\w./-]+\.tsx?):\d+)/i;

const SYMBOL_IMPORTS: Record<string, string> = {
  Router: 'import { BrowserRouter as Router } from "react-router-dom"\n',
  Routes: 'import { Routes } from "react-router-dom"\n',
  Route: 'import { Route } from "react-router-dom"\n',
  Link: 'import { Link } from "react-router-dom"\n',
  Navigate: 'import { Navigate } from "react-router-dom"\n',
  Outlet: 'import { Outlet } from "react-router-dom"\n',
};

function prependImports(content: string, lines: string[]): string {
  const existing = new Set(
    content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("import ")),
  );
  const toAdd = lines.filter((l) => !existing.has(l.trim()));
  if (!toAdd.length) return content;
  return `${toAdd.join("")}${content}`;
}

export function buildUndefinedSymbolHealOps(
  compileLog: string,
  projectFiles?: Record<string, string>,
): DevStudioOp[] | null {
  const symMatch = compileLog.match(UNDEFINED_SYM_RE);
  if (!symMatch || !projectFiles) return null;
  const symbol = symMatch[1];
  const importLine = SYMBOL_IMPORTS[symbol];
  if (!importLine) return null;

  const fileMatch = compileLog.match(STACK_FILE_RE);
  const path = (fileMatch?.[1] ?? fileMatch?.[2] ?? "src/App.tsx").replace(/\\/g, "/");
  const existing = projectFiles[path];
  if (!existing) return null;
  if (existing.includes(importLine.trim())) return null;

  return [
    {
      op: "write",
      path,
      content: prependImports(existing, [importLine]),
    },
  ];
}
