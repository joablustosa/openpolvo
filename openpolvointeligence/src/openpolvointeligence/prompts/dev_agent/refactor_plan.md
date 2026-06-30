# Plano — Refactor

Reestruturação com impacto mapeado. Preservar comportamento.

```json
{
  "execution_plan": {
    "workflow": "refactor",
    "summary": "Extrair hooks de data fetching",
    "scope": "frontend",
    "steps": [
      "Criar src/hooks/useContracts.ts",
      "Mover lógica de ContractsPage",
      "Actualizar imports"
    ]
  },
  "refactor_plan": {
    "modules_to_extract": ["src/hooks/useContracts.ts"],
    "modules_to_delete": [],
    "rename_map": {},
    "migration_notes": "Manter API pública dos componentes"
  },
  "impact_analysis": {
    "risk": "medium",
    "affected_layers": ["frontend"],
    "files_estimate": 4
  }
}
```

Ordem: criar novo → migrar → remover antigo.
