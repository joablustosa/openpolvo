"""Testes email_send_reply (Desk SMTP)."""

from openpolvointeligence.graphs.email.email_send_reply import format_smtp_block_for_prompt


def test_format_smtp_block_when_configured():
    block = format_smtp_block_for_prompt(
        {
            "configured": True,
            "from_email": "eu@exemplo.com",
            "host": "smtp.gmail.com",
            "port": 587,
        },
    )
    assert "eu@exemplo.com" in block
    assert "smtp.gmail.com" in block


def test_format_smtp_block_when_missing():
    assert format_smtp_block_for_prompt(None) == ""
    assert format_smtp_block_for_prompt({"configured": False}) == ""
