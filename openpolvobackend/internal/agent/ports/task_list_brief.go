package ports

// TaskItemBrief representa um item na lista enviada ao Intelligence (payload limitado).
type TaskItemBrief struct {
	ID          string  `json:"id"`
	Position    int     `json:"position"`
	Title       string  `json:"title"`
	Description *string `json:"description,omitempty"`
	Status      string  `json:"status"`
	ResultClip  *string `json:"result_preview,omitempty"`
	DueAt       *string `json:"due_at,omitempty"`
}

// TaskListBrief lista de tarefas do utilizador para contexto do agente.
type TaskListBrief struct {
	ID     string          `json:"id"`
	Title  string          `json:"title"`
	Status string          `json:"status"`
	Items  []TaskItemBrief `json:"items,omitempty"`
}
