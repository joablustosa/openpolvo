"""Detectar quando o utilizador pede dados da Web em conjunto com gráficos / relatórios."""

from __future__ import annotations

import re

_WEB_HINTS = re.compile(
    r"\b("
    r"internet|na web|online|pesquisa|pesquisar|google|browser|"
    r"notícias|noticias|actualidad|atualidad|atualizado|actualizado|"
    r"fontes?|sites?|páginas?|paginas?|nytimes|guardian|bbc|reuters|"
    r"headlines|trending|últimas|ultimas|fresh|live|serp|"
    r"duckduckgo|busca|pesquise"
    r")\b",
    re.I,
)


def user_requests_live_web_auxiliary(user_text: str) -> bool:
    """True se o pedido sugere informação actualizada da Web além de dados locais."""
    t = (user_text or "").strip()
    if len(t) < 8:
        return False
    return bool(_WEB_HINTS.search(t))
