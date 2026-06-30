# Plano — Nova Feature

Feature incremental num projecto existente. **Não** recriar scaffold.

```json
{
  "execution_plan": {
    "workflow": "feature",
    "summary": "Página de contactos com formulário",
    "scope": "fullstack",
    "steps": [
      "Criar src/pages/Contact.tsx",
      "Registar rota em main.tsx",
      "Endpoint POST /api/contact no Hono"
    ],
    "files_to_touch": ["src/pages/Contact.tsx", "src/main.tsx", "server/index.ts"]
  },
  "impact_analysis": {
    "risk": "low",
    "affected_layers": ["frontend", "backend"],
    "breaking_changes": false
  },
  "feature_summary": "Formulário de contacto com validação"
}
```

Prioriza PATCHES mínimos em ficheiros existentes.
