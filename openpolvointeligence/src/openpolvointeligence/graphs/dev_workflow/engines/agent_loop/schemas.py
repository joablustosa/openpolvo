"""Esquemas de ferramentas do loop agentico (paridade Claude Code).

Um único catálogo de ferramentas serve os dois modos do runtime híbrido:

* **tool-calling nativo** — os dicts em formato function/OpenAI são passados a
  ``chat.bind_tools(...)`` (OpenAI, Gemini e Ollama capazes).
* **fallback modo-JSON** — ``render_tool_catalog()`` transforma o mesmo catálogo
  num bloco de texto para modelos fracos (Ollama) que respondem uma acção JSON
  por turno.

Manter os dois modos a partir da mesma fonte evita divergência de contrato.
"""

from __future__ import annotations

from typing import Any

# Ferramentas que produzem operações de escrita (polvo_code_ops) ao serem executadas.
WRITE_TOOLS = frozenset({"write_file", "edit", "multi_edit", "search_replace"})

# Ferramentas apenas de leitura/inspecção — seguras e baratas.
READ_TOOLS = frozenset(
    {
        "read_file",
        "grep",
        "glob",
        "list_files",
        "semantic_search",
        "web_search",
        "web_fetch",
        "github",
    },
)


def _fn(
    name: str, description: str, properties: dict[str, Any], required: list[str]
) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required,
                "additionalProperties": False,
            },
        },
    }


_STR = {"type": "string"}


TOOL_SCHEMAS: list[dict[str, Any]] = [
    _fn(
        "read_file",
        "Lê o conteúdo de um ficheiro do projecto. Usa antes de editar.",
        {"path": {**_STR, "description": "Caminho relativo, ex.: src/App.tsx"}},
        ["path"],
    ),
    _fn(
        "grep",
        "Procura um padrão regex nas linhas dos ficheiros (grep -rn). Rápido para localizar símbolos.",
        {
            "pattern": {**_STR, "description": "Expressão regular"},
            "globs": {
                "type": "array",
                "items": _STR,
                "description": "Filtros opcionais, ex.: ['*.ts','*.tsx']",
            },
        },
        ["pattern"],
    ),
    _fn(
        "glob",
        "Lista ficheiros que correspondem a um padrão glob (ex.: 'src/**/*.tsx').",
        {"pattern": {**_STR, "description": "Padrão glob"}},
        ["pattern"],
    ),
    _fn(
        "list_files",
        "Lista ficheiros sob um prefixo/diretório.",
        {"prefix": {**_STR, "description": "Prefixo, ex.: src (default)"}},
        [],
    ),
    _fn(
        "semantic_search",
        "Busca semântica (code-RAG) por trechos relevantes a uma pergunta em linguagem natural.",
        {"query": {**_STR, "description": "Pergunta/descrição do que procuras"}},
        ["query"],
    ),
    _fn(
        "web_search",
        "Pesquisa na web e devolve títulos, URLs e resumos. Usa quando precisas de "
        "documentação, versões de libs, APIs ou mensagens de erro que não estão no projecto. "
        "Precisa de SERPAPI_API_KEY configurada.",
        {
            "query": {**_STR, "description": "Termos de pesquisa em linguagem natural"},
            "max_results": {"type": "integer", "description": "Nº de resultados (1-10, default 5)"},
        },
        ["query"],
    ),
    _fn(
        "web_fetch",
        "Lê o conteúdo textual de uma página web pública (http/https). Usa depois de "
        "web_search para abrir uma URL específica, ou quando o utilizador indica um link.",
        {"url": {**_STR, "description": "URL http(s) pública a ler"}},
        ["url"],
    ),
    _fn(
        "github",
        "GitHub CLI (gh): PRs, issues, checks, repos. Passa o comando sem o 'gh', "
        'ex.: "pr create --title \'x\' --body \'y\'", "pr list", "pr checks", '
        '"issue view 12". Leituras são automáticas; escrita requer aprovação.',
        {"command": {**_STR, "description": "Comando gh sem o 'gh' inicial"}},
        ["command"],
    ),
    _fn(
        "write_file",
        "Cria um ficheiro novo ou reescreve-o por completo. Só para ficheiros novos ou reescrita total.",
        {
            "path": _STR,
            "content": {**_STR, "description": "Conteúdo completo do ficheiro"},
        },
        ["path", "content"],
    ),
    _fn(
        "edit",
        "Edição cirúrgica: substitui old_text por new_text num ficheiro existente. "
        "old_text tem de ser único no ficheiro (erro se ambíguo). Preferido para alterar código.",
        {
            "path": _STR,
            "old_text": {**_STR, "description": "Trecho exacto a substituir (único no ficheiro)"},
            "new_text": {**_STR, "description": "Novo trecho"},
        },
        ["path", "old_text", "new_text"],
    ),
    _fn(
        "multi_edit",
        "Aplica várias edições atómicas ao mesmo ficheiro, em ordem. Se alguma falhar, nenhuma é aplicada.",
        {
            "path": _STR,
            "edits": {
                "type": "array",
                "description": "Lista de {old_text, new_text}",
                "items": {
                    "type": "object",
                    "properties": {"old_text": _STR, "new_text": _STR},
                    "required": ["old_text", "new_text"],
                },
            },
        },
        ["path", "edits"],
    ),
    _fn(
        "run_terminal",
        "Executa um comando de terminal no workspace (ex.: npm install, npm run build, pytest). "
        "Usa para instalar deps, correr build/testes e validar.",
        {"command": {**_STR, "description": "Comando shell"}},
        ["command"],
    ),
    _fn(
        "apply_and_verify",
        "Corre um comando de verificação (typecheck/lint/testes) e devolve os erros para correção. "
        "Se command for omitido, usa a verificação por omissão do projecto.",
        {"command": {**_STR, "description": "Comando de verificação (opcional)"}},
        [],
    ),
    _fn(
        "todo_write",
        "Escreve/actualiza a checklist de tarefas visível no chat. Usa no início de tarefas com "
        "múltiplos passos e marca cada item como completed à medida que avanças.",
        {
            "todos": {
                "type": "array",
                "description": "Lista de {content, status} — status ∈ pending|in_progress|completed",
                "items": {
                    "type": "object",
                    "properties": {
                        "content": _STR,
                        "status": {
                            "type": "string",
                            "enum": ["pending", "in_progress", "completed"],
                        },
                    },
                    "required": ["content", "status"],
                },
            },
        },
        ["todos"],
    ),
    _fn(
        "task",
        "Delega uma sub-tarefa a um subagente especializado (explorer/implementer/reviewer/tester). "
        "Usa para trabalho paralelizável ou isolado. Devolve o resumo do subagente.",
        {
            "subagent_type": {
                "type": "string",
                "enum": ["explorer", "implementer", "reviewer", "tester"],
            },
            "prompt": {**_STR, "description": "Instrução completa e autónoma para o subagente"},
        },
        ["subagent_type", "prompt"],
    ),
]


# Ferramenta legada mantida por compatibilidade (não anunciada no catálogo nativo,
# mas aceite pelo executor).
LEGACY_TOOL_ALIASES = {"search_replace"}


def tool_names() -> list[str]:
    return [t["function"]["name"] for t in TOOL_SCHEMAS]


def render_tool_catalog() -> str:
    """Catálogo textual das ferramentas para o modo-JSON (modelos fracos)."""
    lines: list[str] = []
    for t in TOOL_SCHEMAS:
        fn = t["function"]
        params = fn["parameters"]["properties"]
        req = set(fn["parameters"].get("required") or [])
        arg_desc = ", ".join(f"{k}{'' if k in req else '?'}" for k in params)
        lines.append(f"- `{fn['name']}({arg_desc})` — {fn['description']}")
    return "\n".join(lines)
