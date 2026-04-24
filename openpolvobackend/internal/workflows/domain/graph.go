package domain

// GraphJSON é o contrato persistido em graph_json (nós + arestas para React Flow).
type GraphJSON struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

type GraphNode struct {
	ID       string             `json:"id"`
	Type     string             `json:"type"`               // schedule, goto, click, fill, wait, llm, send_email
	Position map[string]float64 `json:"position,omitempty"` // x, y — opcional no servidor
	Data     NodeData           `json:"data"`
}

type NodeData struct {
	URL       string `json:"url,omitempty"`
	Selector  string `json:"selector,omitempty"`
	Value     string `json:"value,omitempty"`  // fill
	Prompt    string `json:"prompt,omitempty"` // llm mini-prompt
	TimeoutMs int    `json:"timeout_ms,omitempty"`
	Label     string `json:"label,omitempty"`
	// Nó "web_search" (SerpApi):
	// - Query: termos de pesquisa (q).
	// - Kl: região (DuckDuckGo region code, ex.: us-en, br-pt).
	// - Df: filtro de data (d/w/m/y ou "YYYY-MM-DD..YYYY-MM-DD").
	// - Safe: 1 (strict), -1 (moderate), -2 (off).
	// - Start: offset.
	// - M: max results (1..50).
	Query string `json:"query,omitempty"`
	Kl    string `json:"kl,omitempty"`
	Df    string `json:"df,omitempty"`
	Safe  int    `json:"safe,omitempty"`
	Start int    `json:"start,omitempty"`
	M     int    `json:"m,omitempty"`
	// Nó "web_search": motor SerpApi ("duckduckgo" por omissão, "google").
	SearchEngine string `json:"search_engine,omitempty"`
	// Nó "send_email": destinatário directo (email_to) ou UUID de contacto, e conteúdo.
	// email_to tem prioridade; contact_id é fallback (lookup na agenda).
	// No subject/body, o motor substitui {{previous}} (saídas dos predecessores directos com texto)
	// e {{output:NODE_ID}} (saída guardada de um nó llm ou web_search).
	EmailTo      string `json:"email_to,omitempty"`
	ContactID    string `json:"contact_id,omitempty"`
	EmailSubject string `json:"email_subject,omitempty"`
	EmailBody    string `json:"email_body,omitempty"`
	// Nó "schedule": expressão cron (5 campos, p.ex. "0 9 * * *") e fuso IANA.
	Cron            string `json:"cron,omitempty"`
	Timezone        string `json:"timezone,omitempty"`
	ScheduleEnabled bool   `json:"schedule_enabled,omitempty"`
}

type GraphEdge struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Target string `json:"target"`
}
