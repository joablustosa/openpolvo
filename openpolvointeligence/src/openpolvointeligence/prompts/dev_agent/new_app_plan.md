# Plano — Nova Aplicação

Gera JSON com scaffold completo do zero.

```json
{
  "execution_plan": {
    "workflow": "new_app",
    "summary": "Landing + dashboard para ...",
    "scope": "fullstack",
    "steps": [
      "Scaffold Vite+React com rotas",
      "Layout marketing (Navbar + Hero)",
      "API Hono com health check",
      "Páginas principais"
    ],
    "pages": ["Home", "Sobre", "Contacto"],
    "stack": "vite-react"
  },
  "feature_summary": "Site institucional com formulário de contacto"
}
```

Regras: incluir `design_tokens` implícitos no plano (zinc/slate, accent único). Listar páginas e integrações necessárias.
