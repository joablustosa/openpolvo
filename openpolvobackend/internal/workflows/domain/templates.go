package domain

import (
	"fmt"
	"strings"
)

// WorkflowTemplate é um preset pronto (1 clique) de automação.
type WorkflowTemplate struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Graph       GraphJSON `json:"graph"`
}

// ResearchEmailParams parametriza o template "Pesquisa → E-mail".
type ResearchEmailParams struct {
	Query      string
	EmailTo    string
	Cron       string
	Timezone   string
	MaxResults int
}

const (
	defaultResearchQuery = "principais notícias de tecnologia hoje"
	defaultResearchCron  = "0 8 * * *" // todos os dias às 08:00
	defaultResearchTZ    = "America/Sao_Paulo"
	defaultResearchMax   = 8
)

func (p ResearchEmailParams) withDefaults() ResearchEmailParams {
	if strings.TrimSpace(p.Query) == "" {
		p.Query = defaultResearchQuery
	}
	if strings.TrimSpace(p.Cron) == "" {
		p.Cron = defaultResearchCron
	}
	if strings.TrimSpace(p.Timezone) == "" {
		p.Timezone = defaultResearchTZ
	}
	if p.MaxResults <= 0 || p.MaxResults > 50 {
		p.MaxResults = defaultResearchMax
	}
	return p
}

// ResearchEmailGraph constrói o grafo determinístico do template:
//
//	schedule (cron diário) → web_search (com enriquecimento) → send_email
//
// O corpo do e-mail usa {{output:search}} — o motor substitui pela saída enriquecida
// da pesquisa. Depende apenas de SERPAPI (pesquisa) + SMTP (envio); não requer LLM.
func ResearchEmailGraph(p ResearchEmailParams) GraphJSON {
	p = p.withDefaults()
	const (
		schedID  = "schedule-1"
		searchID = "search-1"
		emailID  = "email-1"
	)
	subject := fmt.Sprintf("Resumo diário: %s", p.Query)
	body := fmt.Sprintf(
		"Resultados da pesquisa sobre \"%s\":\n\n{{output:%s}}\n\n— Enviado automaticamente pelo OpenPolvo.",
		p.Query, searchID,
	)
	return GraphJSON{
		Nodes: []GraphNode{
			{
				ID:       schedID,
				Type:     "schedule",
				Position: map[string]float64{"x": 80, "y": 80},
				Data: NodeData{
					Label:           "Agendamento diário",
					Cron:            p.Cron,
					Timezone:        p.Timezone,
					ScheduleEnabled: true,
				},
			},
			{
				ID:       searchID,
				Type:     "web_search",
				Position: map[string]float64{"x": 80, "y": 240},
				Data: NodeData{
					Label:        "Pesquisar na internet",
					Query:        p.Query,
					M:            p.MaxResults,
					SearchEngine: "duckduckgo",
					// enriquecimento ligado: fetch + resumo por URL via Intelligence.
					WebSearchSkipPageFetch: false,
				},
			},
			{
				ID:       emailID,
				Type:     "send_email",
				Position: map[string]float64{"x": 80, "y": 400},
				Data: NodeData{
					Label:        "Enviar e-mail",
					EmailTo:      strings.TrimSpace(p.EmailTo),
					EmailSubject: subject,
					EmailBody:    body,
				},
			},
		},
		Edges: []GraphEdge{
			{ID: "e-sched-search", Source: schedID, Target: searchID},
			{ID: "e-search-email", Source: searchID, Target: emailID},
		},
	}
}

// AllTemplates devolve os presets disponíveis (com defaults preenchidos).
func AllTemplates() []WorkflowTemplate {
	return []WorkflowTemplate{
		{
			ID:    "research_email",
			Title: "Pesquisa → E-mail (diário)",
			Description: "Pesquisa na internet um tema à sua escolha, enriquece os resultados e " +
				"envia um resumo por e-mail todos os dias. Configure o SMTP e o destinatário.",
			Graph: ResearchEmailGraph(ResearchEmailParams{}),
		},
	}
}
