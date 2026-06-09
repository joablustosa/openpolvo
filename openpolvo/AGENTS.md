# openpolvo — Frontend (React 19 + Vite + Electron)

Siga o skill `react-frontend-standards` (estrutura/código) e `frontend-design-system` (visual shadcn base-nova).

## Invariantes

- Lógica pura em `src/lib/` (sem JSX); componentes por feature em `src/components/<feature>/`; primitivos só em `src/components/ui/` (reutilize, não recrie).
- TypeScript estrito: sem `any`, sem `@ts-ignore` injustificado. Aliases `@/...`.
- Hooks no topo; `useEffect` sempre com cleanup e deps corretas. Memoize só onde há custo real.
- UI em português; cores via tokens semânticos; sem `console.log`/código morto.

## Portão antes de concluir

`tsc` sem erros + `vite build` limpo.

## Contrato com o backend

Consome a API HTTP do `openpolvobackend`. Não invente shapes — confirme o contrato JSON antes de implementar.
