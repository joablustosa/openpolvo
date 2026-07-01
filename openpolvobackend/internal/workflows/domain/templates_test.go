package domain

import (
	"strings"
	"testing"
)

func nodesByType(g GraphJSON) map[string]GraphNode {
	m := make(map[string]GraphNode)
	for _, n := range g.Nodes {
		m[strings.ToLower(n.Type)] = n
	}
	return m
}

func TestResearchEmailGraph_Defaults(t *testing.T) {
	g := ResearchEmailGraph(ResearchEmailParams{})
	byType := nodesByType(g)

	sched, ok := byType["schedule"]
	if !ok {
		t.Fatal("faltou nó schedule")
	}
	if sched.Data.Cron != defaultResearchCron || !sched.Data.ScheduleEnabled {
		t.Fatalf("schedule mal configurado: %+v", sched.Data)
	}
	if sched.Data.Timezone != defaultResearchTZ {
		t.Fatalf("timezone default inesperado: %q", sched.Data.Timezone)
	}

	search, ok := byType["web_search"]
	if !ok {
		t.Fatal("faltou nó web_search")
	}
	if strings.TrimSpace(search.Data.Query) == "" {
		t.Fatal("web_search sem query")
	}
	if search.Data.WebSearchSkipPageFetch {
		t.Fatal("enriquecimento deveria estar ligado (skip_page_fetch=false)")
	}

	email, ok := byType["send_email"]
	if !ok {
		t.Fatal("faltou nó send_email")
	}
	// Corpo deve referenciar a saída da pesquisa para não ficar vazio após expandir.
	if !strings.Contains(email.Data.EmailBody, "{{output:") {
		t.Fatalf("email_body não referencia a saída da pesquisa: %q", email.Data.EmailBody)
	}
	if strings.TrimSpace(email.Data.EmailSubject) == "" {
		t.Fatal("email_subject vazio")
	}
}

func TestResearchEmailGraph_Params(t *testing.T) {
	g := ResearchEmailGraph(ResearchEmailParams{
		Query:      "notícias de IA",
		EmailTo:    "user@example.com",
		Cron:       "0 7 * * 1",
		Timezone:   "Europe/Lisbon",
		MaxResults: 12,
	})
	byType := nodesByType(g)
	if byType["web_search"].Data.Query != "notícias de IA" {
		t.Fatalf("query não aplicada: %q", byType["web_search"].Data.Query)
	}
	if byType["web_search"].Data.M != 12 {
		t.Fatalf("max results não aplicado: %d", byType["web_search"].Data.M)
	}
	if byType["send_email"].Data.EmailTo != "user@example.com" {
		t.Fatalf("email_to não aplicado: %q", byType["send_email"].Data.EmailTo)
	}
	if byType["schedule"].Data.Cron != "0 7 * * 1" {
		t.Fatalf("cron não aplicado: %q", byType["schedule"].Data.Cron)
	}
}

func TestResearchEmailGraph_ScheduleExtraction(t *testing.T) {
	// O grafo do template deve alimentar o agendador via ApplyScheduleFromGraph.
	g := ResearchEmailGraph(ResearchEmailParams{Cron: "0 9 * * *", Timezone: "America/Sao_Paulo"})
	w := &Workflow{Graph: g}
	ApplyScheduleFromGraph(w)
	if w.ScheduleCron == nil || *w.ScheduleCron != "0 9 * * *" {
		t.Fatalf("cron não extraído do grafo: %+v", w.ScheduleCron)
	}
	if !w.ScheduleEnabled {
		t.Fatal("schedule deveria estar ativo")
	}
	if w.ScheduleTimezone != "America/Sao_Paulo" {
		t.Fatalf("timezone não extraído: %q", w.ScheduleTimezone)
	}
}

func TestResearchEmailGraph_EdgesConnectPipeline(t *testing.T) {
	g := ResearchEmailGraph(ResearchEmailParams{})
	if len(g.Edges) != 2 {
		t.Fatalf("esperava 2 arestas, obtive %d", len(g.Edges))
	}
	ids := make(map[string]bool)
	for _, n := range g.Nodes {
		ids[n.ID] = true
	}
	for _, e := range g.Edges {
		if !ids[e.Source] || !ids[e.Target] {
			t.Fatalf("aresta liga nós inexistentes: %+v", e)
		}
	}
}

func TestAllTemplates_HasResearchEmail(t *testing.T) {
	tpls := AllTemplates()
	if len(tpls) == 0 {
		t.Fatal("nenhum template")
	}
	var found bool
	for _, tpl := range tpls {
		if tpl.ID == "research_email" {
			found = true
			if strings.TrimSpace(tpl.Title) == "" || strings.TrimSpace(tpl.Description) == "" {
				t.Fatal("template sem título/descrição")
			}
			if len(tpl.Graph.Nodes) == 0 {
				t.Fatal("template sem grafo")
			}
		}
	}
	if !found {
		t.Fatal("template research_email ausente")
	}
}
