"""Renderização determinística Markdown → PDF (zero-token)."""

from __future__ import annotations

import base64
import re
from html import escape
from io import BytesIO
from typing import Any

import markdown
from xhtml2pdf import pisa

_MAX_PDF_BYTES = 1_500_000
_SLUG_RE = re.compile(r"[^a-z0-9]+", re.IGNORECASE)

_PDF_CSS = """
@page {
    size: A4;
    margin: 2.2cm 2cm 2.4cm 2cm;
    @frame footer {
        -pdf-frame-content: footerContent;
        bottom: 0.8cm;
        margin-left: 2cm;
        margin-right: 2cm;
        height: 1cm;
    }
}
body {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.55;
    color: #1a1a1a;
}
h1 {
    font-size: 22pt;
    font-weight: bold;
    color: #0f172a;
    margin: 0 0 14pt 0;
    padding-bottom: 8pt;
    border-bottom: 2pt solid #e2e8f0;
}
h2 {
    font-size: 14pt;
    font-weight: bold;
    color: #1e293b;
    margin: 18pt 0 8pt 0;
}
h3 {
    font-size: 11.5pt;
    font-weight: bold;
    color: #334155;
    margin: 12pt 0 6pt 0;
}
p { margin: 0 0 8pt 0; }
ul, ol { margin: 0 0 10pt 16pt; padding: 0; }
li { margin-bottom: 4pt; }
blockquote {
    margin: 10pt 0;
    padding: 8pt 12pt;
    border-left: 3pt solid #94a3b8;
    background: #f8fafc;
    color: #475569;
}
table {
    width: 100%;
    border-collapse: collapse;
    margin: 10pt 0 14pt 0;
    font-size: 9.5pt;
}
th {
    background: #f1f5f9;
    font-weight: bold;
    text-align: left;
    padding: 6pt 8pt;
    border: 0.5pt solid #cbd5e1;
}
td {
    padding: 6pt 8pt;
    border: 0.5pt solid #e2e8f0;
    vertical-align: top;
}
code {
    font-family: Courier, monospace;
    font-size: 9pt;
    background: #f1f5f9;
    padding: 1pt 3pt;
}
pre {
    background: #0f172a;
    color: #e2e8f0;
    padding: 10pt;
    font-size: 8.5pt;
    line-height: 1.45;
    white-space: pre-wrap;
    margin: 10pt 0;
}
pre code { background: transparent; color: inherit; padding: 0; }
.cover-meta {
    font-size: 9.5pt;
    color: #64748b;
    margin-bottom: 18pt;
}
.footer {
    font-size: 8pt;
    color: #94a3b8;
    text-align: center;
}
"""


def slugify_filename(title: str, *, prefix: str = "estudo") -> str:
    base = _SLUG_RE.sub("-", (title or prefix).strip().lower()).strip("-")
    if not base:
        base = prefix
    return f"{base[:72]}.pdf"


def markdown_to_html(markdown_text: str, *, title: str = "Documento") -> str:
    body = markdown.markdown(
        markdown_text or "",
        extensions=["tables", "fenced_code", "sane_lists", "nl2br"],
    )
    safe_title = escape(title)
    return f"""<!DOCTYPE html>
<html lang="pt">
<head>
    <meta charset="utf-8"/>
    <title>{safe_title}</title>
    <style>{_PDF_CSS}</style>
</head>
<body>
    <div class="cover-meta">Open Polvo · Documento profissional</div>
    {body}
    <div id="footerContent" class="footer">Gerado pelo Open Polvo · {safe_title}</div>
</body>
</html>"""


def render_pdf_bytes(markdown_text: str, *, title: str = "Documento") -> bytes:
    html = markdown_to_html(markdown_text, title=title)
    buf = BytesIO()
    status = pisa.CreatePDF(html, dest=buf, encoding="utf-8")
    if status.err:
        raise RuntimeError(f"pdf render failed with {status.err} error(s)")
    return buf.getvalue()


def build_pdf_metadata(
    pdf_bytes: bytes,
    *,
    filename: str,
    markdown_text: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "document_kind": "pdf_study_report",
        "document_format": "application/pdf",
        "pdf_export_suggested_filename": filename,
        "pdf_markdown_chars": len(markdown_text or ""),
    }
    if extra:
        meta.update(extra)
    if len(pdf_bytes) <= _MAX_PDF_BYTES:
        meta["pdf_document_base64"] = base64.b64encode(pdf_bytes).decode("ascii")
        meta["pdf_size_bytes"] = len(pdf_bytes)
    else:
        meta["pdf_too_large"] = True
        meta["pdf_size_bytes"] = len(pdf_bytes)
    return meta
