from openpolvointeligence.graphs.web_research_intent import user_requests_live_web_auxiliary


def test_detects_web_keywords() -> None:
    assert user_requests_live_web_auxiliary("Faz um gráfico e pesquisa na internet as últimas notícias") is True
    assert user_requests_live_web_auxiliary("Dashboard de vendas internas Q3") is False
