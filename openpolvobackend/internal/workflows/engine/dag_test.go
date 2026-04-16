package engine

import (
	"testing"

	"github.com/open-polvo/open-polvo/internal/workflows/domain"
)

func TestOrderNodes_linear(t *testing.T) {
	g := domain.GraphJSON{
		Nodes: []domain.GraphNode{
			{ID: "a", Type: "goto"},
			{ID: "b", Type: "click"},
		},
		Edges: []domain.GraphEdge{{ID: "e1", Source: "a", Target: "b"}},
	}
	order, err := OrderNodes(g)
	if err != nil {
		t.Fatal(err)
	}
	if len(order) != 2 || order[0] != "a" || order[1] != "b" {
		t.Fatalf("got %v", order)
	}
}

func TestOrderNodes_cycle(t *testing.T) {
	g := domain.GraphJSON{
		Nodes: []domain.GraphNode{{ID: "a", Type: "goto"}, {ID: "b", Type: "click"}},
		Edges: []domain.GraphEdge{
			{ID: "e1", Source: "a", Target: "b"},
			{ID: "e2", Source: "b", Target: "a"},
		},
	}
	_, err := OrderNodes(g)
	if err == nil {
		t.Fatal("expected cycle error")
	}
}
