# openpolvointeligence — Intelligence (Python 3.11, LangGraph + FastAPI + RAG)

Siga o skill `python-intelligence-standards`.

## Invariantes

- `src/` layout: `api/` (FastAPI), `graphs/` (nós/subgrafos LangGraph), `core/` (config), `code_rag/` (RAG). Testes em `tests/`.
- `from __future__ import annotations`; type hints completos (`X | None`, `Literal`). Sem imports/variáveis mortos.
- Separe a **camada determinística (zero-token)** dos nós LLM; lógica de decisão em funções puras testáveis. Estado tipado em `*_state.py`.
- Config só via `core/config.py` (pydantic-settings). Handlers async sem bloqueio. Nunca `except: pass`.
- LLM é caro: passe pela camada determinística e pelo RAG antes de chamar o modelo; limite contexto/tokens.

## Portão antes de concluir

`ruff check` + `ruff format --check` + `pytest` (asyncio_mode=auto; não chamar LLM real em teste).

## Contrato

Servido via FastAPI e consumido pelo `openpolvobackend`. Schemas pydantic em `api/schemas.py` são o contrato.
