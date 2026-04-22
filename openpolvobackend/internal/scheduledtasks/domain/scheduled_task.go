package domain

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// TaskType identifica o que o scheduler executa quando a tarefa dispara.
type TaskType string

const (
	TaskTypeAgentPrompt  TaskType = "agent_prompt"  // Chama o agente com um prompt + envia resultado por email
	TaskTypeRunTaskList  TaskType = "run_task_list"  // Executa uma task list persistida
)

// ScheduledTask é uma tarefa recorrente definida por expressão CRON.
type ScheduledTask struct {
	ID          uuid.UUID
	UserID      uuid.UUID
	Name        string
	Description string
	TaskType    TaskType
	Payload     map[string]any // varia por TaskType
	CronExpr    string         // ex: "0 20 * * *"
	Timezone    string         // IANA ex: "America/Sao_Paulo"
	Active      bool
	LastRunAt   *time.Time
	LastResult  string
	LastError   string
	RunCount    int
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// AgentPromptPayload é o payload para TaskTypeAgentPrompt.
type AgentPromptPayload struct {
	Prompt         string `json:"prompt"`
	SendEmail      bool   `json:"send_email"`
	EmailSubject   string `json:"email_subject,omitempty"`
	IncludeTasks   bool   `json:"include_tasks"`
	IncludeFinance bool   `json:"include_finance"`
}

// RunTaskListPayload é o payload para TaskTypeRunTaskList.
type RunTaskListPayload struct {
	TaskListID   string `json:"task_list_id"`
	TaskListName string `json:"task_list_name,omitempty"`
}

func (t *ScheduledTask) PayloadJSON() (string, error) {
	if t.Payload == nil {
		return "{}", nil
	}
	b, err := json.Marshal(t.Payload)
	if err != nil {
		return "{}", err
	}
	return string(b), nil
}

func ParsePayload(raw string) (map[string]any, error) {
	if raw == "" || raw == "{}" {
		return map[string]any{}, nil
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return map[string]any{}, err
	}
	return m, nil
}
