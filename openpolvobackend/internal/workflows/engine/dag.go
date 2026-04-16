package engine

import (
	"fmt"

	"github.com/open-polvo/open-polvo/internal/workflows/domain"
)

// OrderNodes devolve IDs dos nós por ordem topológica (DAG). Raízes primeiro.
func OrderNodes(g domain.GraphJSON) ([]string, error) {
	ids := make(map[string]struct{})
	for _, n := range g.Nodes {
		if n.ID == "" {
			return nil, fmt.Errorf("nó sem id")
		}
		ids[n.ID] = struct{}{}
	}
	inDeg := make(map[string]int)
	for id := range ids {
		inDeg[id] = 0
	}
	adj := make(map[string][]string)
	for _, e := range g.Edges {
		if e.Source == "" || e.Target == "" {
			continue
		}
		if _, ok := ids[e.Source]; !ok {
			return nil, fmt.Errorf("aresta referencia nó inexistente: %s", e.Source)
		}
		if _, ok := ids[e.Target]; !ok {
			return nil, fmt.Errorf("aresta referencia nó inexistente: %s", e.Target)
		}
		adj[e.Source] = append(adj[e.Source], e.Target)
		inDeg[e.Target]++
	}

	var q []string
	for id, d := range inDeg {
		if d == 0 {
			q = append(q, id)
		}
	}
	var out []string
	for len(q) > 0 {
		u := q[0]
		q = q[1:]
		out = append(out, u)
		for _, v := range adj[u] {
			inDeg[v]--
			if inDeg[v] == 0 {
				q = append(q, v)
			}
		}
	}
	if len(out) != len(ids) {
		return nil, fmt.Errorf("grafo com ciclo ou nós desligados")
	}
	return out, nil
}
