# Kit arquitectónico: `frontend_only`

Espelha a estrutura de `openpolvo/src/`. Para apps `frontend_only` segue este file tree.

## File tree obrigatório

```
(root)/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── index.html
├── README.md
└── src/
    ├── main.tsx                       # bootstrap: ReactDOM.createRoot + <App/>
    ├── App.tsx                        # Router + layout top-level
    ├── index.css                      # tokens OKLCH + Tailwind
    ├── lib/
    │   └── utils.ts                   # cn()
    ├── components/
    │   ├── ui/                        # shadcn-style (Button, Input, Card, ...)
    │   └── {feature}/                 # componentes de domínio (ex: TaskList, TaskForm)
    ├── pages/
    │   └── {Page}/
    │       └── {Page}.tsx             # uma pasta por página
    ├── hooks/
    │   └── use{Thing}.ts              # hooks customizados
    └── core/
        └── {Name}Context.tsx          # contextos globais (se necessário)
```

## `package.json` mínimo

```json
{
  "name": "app",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.4"
  },
  "devDependencies": {
    "@fontsource-variable/geist": "^5.1.0",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.3",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.3",
    "vite": "^5.4.10"
  }
}
```

## `vite.config.ts`

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
```

## `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM"],
    "module": "ESNext",
    "jsx": "react-jsx",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

## Regras

- Cada página em pasta própria sob `src/pages/{Name}/` com componente exportado por `{Name}Page`.
- Estado local primeiro; só promover a Context quando ≥ 2 páginas o partilham.
- Fetch via `fetch` nativo ou `src/lib/api.ts` centralizado se há ≥ 3 endpoints.
- `hooks/` para lógica reutilizável; `lib/` para utilitários puros.
- `App.tsx` monta `<BrowserRouter>` + `<Routes>`; layout shell em `core/Shell.tsx` se necessário.
