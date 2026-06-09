"""Extração principal HTML (trafilatura) para pesquisa web."""

from openpolvointeligence.graphs.web_page_fetch import (
    extract_main_content_trafilatura,
    strip_html_to_text,
)


def test_trafilatura_prefers_article_over_nav_noise() -> None:
    html = """
    <html><head><title>News</title></head><body>
    <nav>Home · About · Contact · Login · Subscribe newsletter</nav>
    <article><h1>Acme reports Q3 revenue</h1>
    <p>Revenue reached <strong>42.5M EUR</strong> in the third quarter.</p>
    <p>CEO Jane Doe cited expansion in Iberia.</p>
    </article>
    <footer>Copyright 2026</footer>
    </body></html>
    """
    out = extract_main_content_trafilatura(html, "https://news.example.com/q3", max_chars=8000)
    assert out is not None
    low = out.lower()
    assert "42.5" in low or "42,5" in low
    assert "revenue" in low or "eur" in low


def test_strip_html_fallback_still_works() -> None:
    html = "<html><body><p>Hello <b>world</b></p></body></html>"
    t = strip_html_to_text(html, max_chars=500)
    assert "Hello" in t
    assert "world" in t
