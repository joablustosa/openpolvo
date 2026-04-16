---
name: open-polvo-migrations-naming
description: >-
  Padronizar nomes de ficheiros de migração (golang-migrate): prefixo numérico
  sequencial de 6 dígitos, descrição em snake_case, pares .up/.down. A sequência
  continua sempre a última versão existente em migrations/.
---

# Nomes de migrações Open Polvo

## Formato obrigatório

Cada migração é um **par** de ficheiros na pasta [`migrations/`](migrations/):

```text
{VVVVVV}_{descricao_snake_case}.up.sql
{VVVVVV}_{descricao_snake_case}.down.sql
```

- **`VVVVVV`**: número sequencial com **6 dígitos**, preenchido com zeros à esquerda (`000001`, `000002`, …).
- **`descricao_snake_case`**: minúsculas, palavras separadas por `_`, sem espaços (ex.: `create_users`, `add_laele_sessions_table`, `rename_users_to_laele_users`).
- **Mesmo prefixo e mesma descrição** nos dois ficheiros; só muda a extensão lógica `.up.sql` / `.down.sql`.

Compatível com [golang-migrate](https://github.com/golang-migrate/migrate) (fonte `file://`).

## Regra da sequência

1. **Antes de criar uma migração nova**, lista `migrations/*.up.sql` (ou todos os `.sql`) e identifica o **maior** `VVVVVV` já usado.
2. A próxima migração usa **`último + 1`**, sempre com 6 dígitos (ex.: após `000003_...` vem `000004_...`).
3. **Nunca** reutilizar um número já existente; **nunca** inserir “no meio” com número duplicado — se for preciso reordenar, trata-se de exceção rara e exige revisão manual do histórico e das bases já migradas.

## Boas práticas

- Um **objetivo por migração** (uma alteração de schema coerente), quando possível.
- Nome `descricao` legível em inglês ou português, mas **consistente** no repositório (este projeto usa mistura; prefere **inglês** para nomes de ficheiro se não houver tradição contrária).
- **`up.sql`**: preferir `CREATE TABLE IF NOT EXISTS` / alterações idempotentes quando fizer sentido, para não falhar se o objeto já existir.
- **`down.sql` (política deste repo)**: **não** usar `DROP TABLE` nem apagar dados — usar *no-op* (ex.: `SELECT 1`) e comentário a explicar. Reverter schema em produção: nova migração `up` *forward*.

## Arranque da API vs `down`

O binário só chama `Up()`. O `.down.sql` **nunca** corre ao iniciar a API; só com `migrate down` explícito via CLI.

## Exemplo

Após existir `000001_create_users.up.sql`:

```text
000002_add_laele_refresh_tokens.up.sql
000002_add_laele_refresh_tokens.down.sql
```

## Relação com outras convenções

- Tabelas novas: prefixo `laele_` — ver `.cursor/skills/laele-table-prefix/SKILL.md`.
- Sem segredos em SQL — `.cursor/rules/open-polvo-secrets.mdc`.
