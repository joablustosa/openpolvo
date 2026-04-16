---
name: open-polvo-architecture
description: Hexagonal architecture and DDD conventions for the Open Polvo Go backend.
---

# Open Polvo — arquitetura Go

Ao alterar o backend:

1. Lê `.cursor/rules/open-polvo-architecture.mdc`.
2. Novos fluxos: caso de uso em `internal/<contexto>/application`, interface em `ports`, implementação em `adapters`.
3. O router HTTP em `internal/transport/http` só orquestra; não acrescentes regra de negócio nos handlers.
