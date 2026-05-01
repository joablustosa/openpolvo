from openpolvointeligence.graphs.web_url_extract import pick_urls_for_deep_dive


def test_pick_urls_skips_google_prefers_publishers() -> None:
    snippets = [
        "### Motor: duckduckgo | query: news\n"
        "1. **Story**\n   - URL: https://www.theguardian.com/world/2024/foo\n   - Resumo: x\n"
        "2. **Other**\n   - URL: https://www.google.com/search?q=foo\n   - Resumo: y\n"
        "3. **NYT**\n   - URL: https://www.nytimes.com/2024/01/01/world/asia/bar.html\n   - Resumo: z\n",
    ]
    urls = pick_urls_for_deep_dive(snippets, max_urls=4, max_per_host=2)
    assert "theguardian.com" in urls[0]
    assert "nytimes.com" in "\n".join(urls)
    assert all("google.com/search" not in u for u in urls)


def test_pick_urls_respects_max() -> None:
    lines = "\n".join(
        f"{i}. **T**\n   - URL: https://example{i}.com/p\n   - Resumo: s\n" for i in range(10)
    )
    urls = pick_urls_for_deep_dive([lines], max_urls=2, max_per_host=2)
    assert len(urls) <= 2
