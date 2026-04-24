package engine

import (
	"testing"

	"github.com/open-polvo/open-polvo/internal/workflows/domain"
)

func TestExpandEmailTemplatesPrevious(t *testing.T) {
	g := domain.GraphJSON{
		Nodes: []domain.GraphNode{
			{ID: "a", Type: "llm"},
			{ID: "b", Type: "send_email"},
		},
		Edges: []domain.GraphEdge{{ID: "e1", Source: "a", Target: "b"}},
	}
	order := []string{"a", "b"}
	preds := buildPredecessors(g)
	outputs := map[string]string{"a": "Lista gerada:\n- item 1"}

	got := expandEmailTemplates("Assunto: {{previous}}", "b", order, outputs, preds)
	if got != "Assunto: Lista gerada:\n- item 1" {
		t.Fatalf("got %q", got)
	}
}

func TestExpandEmailTemplatesOutputByID(t *testing.T) {
	order := []string{"x", "y"}
	preds := map[string][]string{}
	outputs := map[string]string{"x": "só isto"}

	got := expandEmailTemplates("{{output:x}}", "y", order, outputs, preds)
	if got != "só isto" {
		t.Fatalf("got %q", got)
	}
}
