---
name: open-polvo-security
description: Segurança e segredos no monorepo Open Polvo (backend Go + front).
---

# Open Polvo — segurança

Ao trabalhar neste repositório:

1. Segue a regra do projeto em `.cursor/rules/open-polvo-secrets.mdc`.
2. Chaves e senhas vivem só em `.env` local (não versionado). Copia de `.env.example`.
3. No backend, configuração sensível entra por variáveis de ambiente (`internal/platform/config`).

Para arquitetura Go, vê `.cursor/rules/open-polvo-architecture.mdc`.
