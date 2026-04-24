package application

import (
	"errors"
	"fmt"
	"strings"

	"github.com/open-polvo/open-polvo/internal/scheduledtasks/domain"
)

func boolFromPayload(m map[string]any, key string) bool {
	if m == nil {
		return false
	}
	v, ok := m[key]
	if !ok || v == nil {
		return false
	}
	switch x := v.(type) {
	case bool:
		return x
	case string:
		s := strings.TrimSpace(strings.ToLower(x))
		return s == "1" || s == "true" || s == "yes"
	case float64:
		return x != 0
	case int:
		return x != 0
	case int64:
		return x != 0
	default:
		return false
	}
}

func stringFromPayload(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	switch x := v.(type) {
	case string:
		return x
	default:
		return strings.TrimSpace(fmt.Sprint(x))
	}
}

// validateScheduledTaskPayload valida o payload antes de persistir.
func validateScheduledTaskPayload(tt domain.TaskType, payload map[string]any) error {
	switch tt {
	case domain.TaskTypeAgentPrompt:
		return validateAgentPromptPayloadMap(payload)
	case domain.TaskTypeRunTaskList:
		return validateRunTaskListPayloadMap(payload)
	default:
		return errors.New("task_type inválido")
	}
}

func validateAgentPromptPayloadMap(payload map[string]any) error {
	if payload == nil {
		return nil
	}
	if strings.TrimSpace(stringFromPayload(payload, "prompt")) == "" {
		return errors.New("prompt é obrigatório")
	}
	if !boolFromPayload(payload, "send_email") {
		return nil
	}
	to := strings.TrimSpace(stringFromPayload(payload, "email_to"))
	if to == "" {
		return errors.New("com envio por email activo, o destinatário (email_to) é obrigatório")
	}
	if !strings.Contains(to, "@") {
		return errors.New("email_to inválido")
	}
	return nil
}

func validateRunTaskListPayloadMap(payload map[string]any) error {
	if payload == nil {
		return errors.New("payload da lista em falta")
	}
	id := strings.TrimSpace(stringFromPayload(payload, "task_list_id"))
	if id == "" {
		return errors.New("task_list_id é obrigatório")
	}
	return nil
}
