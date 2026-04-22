"""Gerador de conteúdo social: scraping de sites + LLM + geração de imagem DALL-E."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx
from langchain_core.messages import HumanMessage, SystemMessage

from openpolvointeligence.core.config import Settings
from openpolvointeligence.graphs.models import effective_provider, get_chat_model

_log = logging.getLogger(__name__)

# ─── Scraping ────────────────────────────────────────────────────────────────

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; OpenPolvoBot/1.0; +https://openpolvo.com)",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
}


def _extract_text(html: str, max_chars: int = 8000) -> str:
    """Extrai texto legível de HTML sem dependência de BS4."""
    # Remove scripts, estilos e comentários.
    html = re.sub(r"<(script|style)[^>]*>.*?</(script|style)>", " ", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<!--.*?-->", " ", html, flags=re.DOTALL)
    # Remove todas as tags restantes.
    text = re.sub(r"<[^>]+>", " ", html)
    # Limpa espaços múltiplos.
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_chars]


async def _fetch_site(client: httpx.AsyncClient, url: str) -> str:
    try:
        resp = await client.get(url, headers=_HEADERS, timeout=15, follow_redirects=True)
        resp.raise_for_status()
        return _extract_text(resp.text)
    except Exception as exc:
        _log.warning("scraping falhou para %s: %s", url, exc)
        return ""


async def scrape_sites(sites: list[str]) -> str:
    """Scrape até 5 sites e concatena o conteúdo útil."""
    if not sites:
        return ""
    async with httpx.AsyncClient() as client:
        texts: list[str] = []
        for url in sites[:5]:
            content = await _fetch_site(client, url)
            if content:
                texts.append(f"[{url}]\n{content[:3000]}")
    return "\n\n---\n\n".join(texts)[:15000]


# ─── Geração de conteúdo com LLM ─────────────────────────────────────────────

_CONTENT_SYSTEM = """És um especialista em marketing digital e redes sociais.
A tua tarefa é analisar os conteúdos fornecidos de sites de referência e criar uma postagem altamente envolvente.

Responde APENAS com um JSON válido com estas chaves exactas:
- "title": string — título chamativo (máx 80 chars)
- "description": string — texto da postagem em português do Brasil, envolvente, informativo e com chamada à acção (máx 400 chars)
- "hashtags": array de strings — 5 a 10 hashtags relevantes sem espaços (ex: "#marketing")
- "image_prompt": string — prompt em inglês para geração de imagem DALL-E (descreve visualmente a postagem, vivid, sem texto/palavras na imagem)
- "source_url": string — URL do artigo/conteúdo mais relevante usado
- "source_title": string — título do artigo/conteúdo fonte

Plataforma alvo: {platform}
{platform_hints}

Não uses markdown, só JSON puro."""

_PLATFORM_HINTS = {
    "instagram": "Para Instagram: foca em visual impactante, legenda concisa, hashtags populares. O image_prompt deve descrever uma cena fotográfica ou design moderno.",
    "facebook": "Para Facebook: pode ser mais extenso, inclui call-to-action claro, hashtags moderadas. O image_prompt deve ser informativo e profissional.",
}


async def generate_post_content(
    settings: Settings,
    model_provider: str | None,
    scraped_content: str,
    platform: str,
) -> dict[str, Any]:
    """Usa LLM para gerar título, descrição, hashtags e prompt de imagem."""
    hints = _PLATFORM_HINTS.get(platform, "")
    system = _CONTENT_SYSTEM.format(platform=platform, platform_hints=hints)

    user_msg = f"""Conteúdo dos sites de referência:

{scraped_content or "(Sem conteúdo disponível — cria um post genérico de tendências do setor)"}

Cria a postagem mais relevante e envolvente possível."""

    chat = get_chat_model(settings, model_provider, json_mode=True)
    resp = await chat.ainvoke([SystemMessage(content=system), HumanMessage(content=user_msg)])
    raw = str(resp.content).strip()

    # Remove cerca de código se existir.
    raw = re.sub(r"^```(?:json)?\s*", "", raw).rstrip("` \n")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        _log.warning("LLM devolveu JSON inválido para social post; fallback")
        data = {}

    return {
        "title": str(data.get("title", "Novidade em destaque")).strip(),
        "description": str(data.get("description", "Confira as últimas tendências!")).strip(),
        "hashtags": [str(h).strip() for h in (data.get("hashtags") or []) if str(h).strip()],
        "image_prompt": str(data.get("image_prompt", "modern digital marketing concept, vibrant colors, professional")).strip(),
        "source_url": str(data.get("source_url", "")).strip(),
        "source_title": str(data.get("source_title", "")).strip(),
    }


# ─── Geração de imagem DALL-E ─────────────────────────────────────────────────

async def generate_image_dalle(settings: Settings, prompt: str) -> str:
    """Gera imagem via DALL-E 3 e devolve a URL pública (válida ~1h)."""
    key = (settings.openai_api_key or "").strip()
    if not key:
        return ""
    try:
        from openai import AsyncOpenAI  # noqa: PLC0415

        client = AsyncOpenAI(api_key=key)
        safe_prompt = prompt[:900] + " No text, no words, no letters in the image." if len(prompt) > 800 else prompt + " No text, no words, no letters in the image."
        resp = await client.images.generate(
            model="dall-e-3",
            prompt=safe_prompt,
            size="1024x1024",
            quality="standard",
            n=1,
        )
        url = resp.data[0].url or ""
        return url
    except Exception as exc:
        _log.warning("DALL-E geração falhou: %s", exc)
        return ""


# ─── Orquestrador principal ───────────────────────────────────────────────────

async def generate_social_post(
    settings: Settings,
    sites: list[str],
    platform: str,
    model_provider: str | None,
    generate_image: bool = True,
) -> dict[str, Any]:
    """Pipeline completo: scrape → LLM content → DALL-E image."""
    mp = effective_provider(model_provider)
    _log.info("social generate: scraping %d sites para %s", len(sites), platform)

    scraped = await scrape_sites(sites)
    content = await generate_post_content(settings, mp, scraped, platform)

    image_url = ""
    if generate_image and content.get("image_prompt"):
        _log.info("social generate: gerando imagem DALL-E")
        image_url = await generate_image_dalle(settings, content["image_prompt"])

    return {
        "title": content["title"],
        "description": content["description"],
        "hashtags": content["hashtags"],
        "image_url": image_url,
        "image_prompt": content["image_prompt"],
        "source_url": content["source_url"],
        "source_title": content["source_title"],
    }
