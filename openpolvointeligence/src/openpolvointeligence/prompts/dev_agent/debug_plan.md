# Plano — Debug / Bug Fix

Corrigir o mínimo necessário. Identificar causa raiz a partir do pedido e erros.

```json
{
  "execution_plan": {
    "workflow": "debug",
    "summary": "Corrigir import em App.tsx",
    "scope": "frontend",
    "steps": [
      "Localizar ficheiro com erro",
      "Aplicar patch pontual",
      "Validar que rotas ainda funcionam"
    ],
    "root_cause_hypothesis": "Import path incorrecto após refactor de pastas"
  },
  "feature_summary": "Correcção de erro de runtime no preview"
}
```

Não reescrever ficheiros inteiros. Listar ficheiros afectados em `files_to_touch`.
