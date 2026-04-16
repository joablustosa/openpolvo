package domain

// GraphJSON é o contrato persistido em graph_json (nós + arestas para React Flow).
type GraphJSON struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

type GraphNode struct {
	ID       string             `json:"id"`
	Type     string             `json:"type"`               // schedule, goto, click, fill, wait, llm
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
