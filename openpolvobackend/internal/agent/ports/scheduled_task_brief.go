package ports

// ScheduledTaskBrief é enviado ao agente Python como contexto de agendamentos existentes.
type ScheduledTaskBrief struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	TaskType string `json:"task_type"`
	CronExpr string `json:"cron_expr"`
	Timezone string `json:"timezone"`
	Active   bool   `json:"active"`
}
