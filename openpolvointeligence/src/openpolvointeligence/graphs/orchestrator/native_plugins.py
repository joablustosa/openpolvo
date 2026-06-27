"""Deteção de plugins nativos (painel ao lado) — alinhado com OpenLaEleFront apps."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass


@dataclass(frozen=True)
class NativePlugin:
    id: str
    label: str
    url: str
    aliases: tuple[str, ...]


_REGISTRY: tuple[NativePlugin, ...] = (
    NativePlugin(
        "whatsapp",
        "WhatsApp",
        "https://web.whatsapp.com/",
        ("whatsapp", "whats app", "zap", "wpp"),
    ),
    NativePlugin(
        "instagram",
        "Instagram",
        "https://www.instagram.com/",
        ("instagram", "insta"),
    ),
    NativePlugin(
        "facebook",
        "Facebook",
        "https://www.facebook.com/",
        ("facebook", "face book", "fb"),
    ),
    NativePlugin(
        "gmail",
        "Gmail",
        "https://mail.google.com/",
        ("gmail", "google mail", "correio google"),
    ),
    NativePlugin(
        "smartbus",
        "SmartBus",
        "https://preprod-guanabara-backoffice-smartbus.smarttravelit.com/#/login",
        ("smartbus", "smart bus"),
    ),
    NativePlugin(
        "gbtech",
        "Portal GbTech",
        "https://dev-portal.gbtech.guanabaraholding.com.br/#/",
        ("portal gbtech", "portal gbt", "gbtech", "gb tech"),
    ),
    NativePlugin(
        "clickbus",
        "Clickbus",
        "https://www.clickbus.com.br/",
        ("clickbus", "click bus"),
    ),
    NativePlugin(
        "buscaonibus",
        "Busca Ônibus",
        "https://www.buscaonibus.com.br/",
        ("busca onibus", "busca ônibus", "buscaonibus"),
    ),
)

_OPEN_INTENT = re.compile(
    r"(^|[\s,.;:!?])(aba|abrir|abre|mostrar|mostra|ver\s+o\s+site|painel|lado\s+direito|embutir|navegar|ir\s+para\s+o|ir\s+para\s+a|abrir\s+o|abrir\s+a)",
    re.IGNORECASE,
)


def normalize_user_text(s: str) -> str:
    s = s.lower().strip()
    out: list[str] = []
    for ch in s:
        if ch.isspace():
            out.append(" ")
        elif ch.isalnum():
            out.append(ch)
        elif ch in "-_":
            out.append(" ")
        else:
            # strip accents roughly
            n = unicodedata.normalize("NFKD", ch)
            base = "".join(c for c in n if not unicodedata.combining(c))
            if base.lower() in "aaaaeeeeiiiioooouuuu":
                out.append(base.lower()[0] if base else ch)
            elif base.lower() in "c":
                out.append("c")
            else:
                continue
    r = "".join(out)
    while "  " in r:
        r = r.replace("  ", " ")
    return r.strip()


def _has_open_site_intent(normalized: str) -> bool:
    if _OPEN_INTENT.search(normalized):
        return True
    if normalized.startswith("aba "):
        return True
    return False


def match_native_plugin(last_user_message: str) -> tuple[str, str, str] | None:
    """Se detectar pedido de abrir site nativo, devolve (id, url, label)."""
    n = normalize_user_text(last_user_message)
    if not n:
        return None
    if not _has_open_site_intent(n):
        return None
    for p in _REGISTRY:
        for alias in p.aliases:
            a = normalize_user_text(alias)
            if not a:
                continue
            if a in n:
                return (p.id, p.url, p.label)
    return None
