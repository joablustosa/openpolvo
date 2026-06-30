# Plano — API Design

Desenhar contrato OpenAPI 3.1 antes da implementação.

```json
{
  "execution_plan": {
    "workflow": "api_design",
    "summary": "API REST de contratos",
    "scope": "backend",
    "steps": [
      "Modelar recursos Contract e Party",
      "Definir CRUD + filtros",
      "Documentar erros padrão"
    ]
  },
  "openapi_spec": {
    "openapi": "3.1.0",
    "info": { "title": "Contracts API", "version": "1.0.0" },
    "paths": {
      "/api/contracts": {
        "get": { "summary": "Listar contratos" },
        "post": { "summary": "Criar contrato" }
      }
    }
  },
  "feature_summary": "Contrato OpenAPI para módulo de contratos"
}
```

Foco em paths, métodos, schemas e códigos HTTP. Implementação vem no pipeline core.
