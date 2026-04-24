---
name: laele-table-prefix
description: >-
  Convenção Open Polvo: todas as tabelas novas (SQLite) devem começar pelo prefixo
  laele_. Aplica-se a migrações SQL, DDL e queries nos adaptadores. Use ao criar
  schema, migrations ou repositórios.
---

# Prefixo de tabelas `laele_`

## Regra

- **Todas as tabelas criadas a partir de agora** no projeto Open Polvo devem ter o prefixo **`laele_`** no nome.
- Formato: `laele_<nome_em_snake_case>` (ex.: `laele_users`, `laele_sessions`, `laele_agent_runs`).
- **Não** criar tabelas sem prefixo (evitar nomes genéricos como `users` sozinho em novas migrações).

## Onde aplicar

1. **Ficheiros em `migrations/`** — `CREATE TABLE`, `DROP TABLE`, `ALTER TABLE`, `REFERENCES`, índices e FKs devem usar o nome completo com prefixo.
2. **Adaptadores SQL** (ex.: `internal/**/adapters/sqlite/`) — `FROM`, `INTO`, `JOIN`, `UPDATE` devem referir tabelas com o prefixo correto.
3. **Documentação / diagramas** de schema no repositório — alinhar com a mesma convenção.

## Tabelas já existentes

- Migrações ou código que já usam nomes **sem** prefixo (legado) só devem ser alterados com **nova migração** explícita (rename ou cópia + cutover), ajustando queries na mesma alteração. Não misturar convenções na mesma tabela sem plano de migração.

## Exemplo

```sql
CREATE TABLE laele_refresh_tokens (
    id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT fk_laele_refresh_user FOREIGN KEY (user_id) REFERENCES laele_users (id)
);
```

## Relação com outras regras

- Segue também `.cursor/rules/open-polvo-architecture.mdc` (SQL só em adaptadores / migrações).
- Nunca colocar segredos em SQL ou exemplos — `.cursor/rules/open-polvo-secrets.mdc`.
