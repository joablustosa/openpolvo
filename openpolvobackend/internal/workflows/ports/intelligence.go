package ports

import (
	"context"

	"github.com/open-polvo/open-polvo/internal/conversations/domain"
)

// WebSearchOrganicHit é um resultado orgânico SerpAPI (título, URL, snippet).
type WebSearchOrganicHit struct {
	Title   string `json:"title"`
	Link    string `json:"link"`
	Snippet string `json:"snippet"`
}

// WebSearchEnrichInput alimenta o Intelligence para extração trafilatura + agente por URL (workflows).
type WebSearchEnrichInput struct {
	Query   string                 `json:"query"`
	Engine  string                 `json:"engine"`
	Results []WebSearchOrganicHit  `json:"results"`
}

// WebSearchEnricher enriquece a saída do nó web_search com conteúdo das páginas (Open Polvo Intelligence).
type WebSearchEnricher interface {
	EnrichWebSearch(
		ctx context.Context,
		provider domain.ModelProvider,
		ov LLMOverrides,
		in WebSearchEnrichInput,
	) (string, error)
}

// LLMOverrides credenciais opcionais para o Open Polvo Intelligence (perfis SQLite na API Go).
type LLMOverrides struct {
	OpenAIAPIKey  string
	GoogleAPIKey  string
	OpenAIModel   string
	GoogleModel   string
}

// IntelligenceService gera texto e JSON via serviço Python (Open Polvo Intelligence).
type IntelligenceService interface {
	GenerateGraphJSON(ctx context.Context, provider domain.ModelProvider, ov LLMOverrides, userRequest, recordingJSON string) (string, error)
	GenerateText(ctx context.Context, provider domain.ModelProvider, ov LLMOverrides, system, user string) (string, error)
}
