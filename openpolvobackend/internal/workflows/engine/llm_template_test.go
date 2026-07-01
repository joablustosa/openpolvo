package engine

import (
	"testing"

	"github.com/open-polvo/open-polvo/internal/workflows/domain"
)

// Garante que o prompt do nó llm expande {{output:ID}} / {{previous}} — o mesmo
// contrato de template do send_email — para permitir web_search → llm(resumo) → email.
func TestLLMPromptTemplateExpansion(t *testing.T) {
	g := domain.GraphJSON{
		Nodes: []domain.GraphNode{
			{ID: "search", Type: "web_search"},
			{ID: "summary", Type: "llm"},
		},
		Edges: []domain.GraphEdge{{ID: "e1", Source: "search", Target: "summary"}},
	}
	order := []string{"search", "summary"}
	preds := buildPredecessors(g)
	outputs := map[string]string{"search": "1. Título — resumo"}

	// Referência explícita por ID.
	got := expandEmailTemplates("Resuma: {{output:search}}", "summary", order, outputs, preds)
	if got != "Resuma: 1. Título — resumo" {
		t.Fatalf("expansão por ID falhou: %q", got)
	}
	// Referência ao predecessor direto.
	got2 := expandEmailTemplates("Resuma: {{previous}}", "summary", order, outputs, preds)
	if got2 != "Resuma: 1. Título — resumo" {
		t.Fatalf("expansão {{previous}} falhou: %q", got2)
	}
}
