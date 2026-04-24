---
name: open-polvo-readme
description: >-
  Projeto open source Open Polvo: manter README.md alinhado com funcionalidades
  novas e com a forma de configurar e executar o projeto. Use após mudanças em
  API, env, migrações, front, Electron ou scripts.
---

# README em projetos open source (Open Polvo)

## Objetivo

O [README.md](README.md) na raiz é a porta de entrada para contribuidores e utilizadores. **Sempre que alterares funcionalidade relevante ou a forma de correr o projeto**, atualiza o README **no mesmo conjunto de alterações** (ou imediatamente a seguir), salvo pedido explícito em contrário.

## Quando atualizar (gatilhos)

Atualiza o README quando houver mudanças em:

- **API HTTP**: rotas novas/removidas, contratos JSON, autenticação.
- **Configuração**: variáveis em [`.env.example`](.env.example), flags, CORS, Open Polvo Intelligence, ports.
- **Execução**: comandos `go run`, `npm`, Electron, Docker, CI, migrações manuais vs automáticas.
- **Requisitos**: versões de Go, Node, Python, SQLite (ficheiro local), ferramentas.
- **Front** ([OpenLaEleFront](OpenLaEleFront)): proxy Vite, `VITE_API_BASE_URL`, fluxo de login, build/preview.
- **Estrutura** importante: novos `cmd/`, contextos em `internal/`, convções (ex.: prefixo `laele_` em tabelas).
- **Segurança / operação** que afete quem clona o repo (ex.: seed, registo, CORS).

## O que manter no README

- Secções claras: requisitos, configuração rápida, como arrancar API e (se aplicável) front, resumo da API ou link para documentação mais longa.
- Comandos **copiáveis** e caminhos corretos relativos à raiz do repositório.
- Referência à licença ([LICENSE](LICENSE)).
- Linguagem alinhada ao resto do README do projeto (pt).

## O que nunca pôr no README

- Passwords, API keys, tokens ou conteúdo de `.env` real — só placeholders e referência a `.env.example`.
- Dados pessoais ou credenciais de exemplo “reais”.

## Front-end com detalhe extra

- Se o fluxo de UI merecer documentação longa, podes acrescentar secção no README raiz **ou** criar/atualizar `OpenLaEleFront/README.md` e **ligar** a partir do README raiz para não dispersar informação crítica de execução.

## Checklist rápido antes de concluir uma alteração grande

1. `.env.example` reflete env novos? → README menciona-os se forem necessários ao primeiro arranque.
2. Novo binário ou script? → README tem o comando.
3. Contribuidor novo consegue ir de clone a API + login só com o README? → ajusta o que faltar.
