package application

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/scheduledtasks/domain"
	"github.com/open-polvo/open-polvo/internal/scheduledtasks/ports"
)

// ─── DTOs ────────────────────────────────────────────────────────────────────

type ScheduledTaskDTO struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	TaskType    string         `json:"task_type"`
	Payload     map[string]any `json:"payload"`
	CronExpr    string         `json:"cron_expr"`
	Timezone    string         `json:"timezone"`
	Active      bool           `json:"active"`
	LastRunAt   *time.Time     `json:"last_run_at,omitempty"`
	LastResult  string         `json:"last_result,omitempty"`
	LastError   string         `json:"last_error,omitempty"`
	RunCount    int            `json:"run_count"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

func toDTO(t *domain.ScheduledTask) ScheduledTaskDTO {
	return ScheduledTaskDTO{
		ID: t.ID.String(), Name: t.Name, Description: t.Description,
		TaskType: string(t.TaskType), Payload: t.Payload,
		CronExpr: t.CronExpr, Timezone: t.Timezone, Active: t.Active,
		LastRunAt: t.LastRunAt, LastResult: t.LastResult, LastError: t.LastError,
		RunCount: t.RunCount, CreatedAt: t.CreatedAt, UpdatedAt: t.UpdatedAt,
	}
}

// ─── CreateScheduledTask ──────────────────────────────────────────────────────

type CreateScheduledTask struct {
	Repo ports.ScheduledTaskRepository
}

type CreateInput struct {
	Name        string
	Description string
	TaskType    domain.TaskType
	Payload     map[string]any
	CronExpr    string
	Timezone    string
	Active      bool
}

func (uc *CreateScheduledTask) Execute(ctx context.Context, userID uuid.UUID, in CreateInput) (ScheduledTaskDTO, error) {
	if strings.TrimSpace(in.Name) == "" {
		return ScheduledTaskDTO{}, errors.New("nome obrigatório")
	}
	if strings.TrimSpace(in.CronExpr) == "" {
		return ScheduledTaskDTO{}, errors.New("expressão CRON obrigatória")
	}
	if in.TaskType != domain.TaskTypeAgentPrompt && in.TaskType != domain.TaskTypeRunTaskList {
		return ScheduledTaskDTO{}, errors.New("task_type inválido")
	}
	tz := strings.TrimSpace(in.Timezone)
	if tz == "" {
		tz = "UTC"
	}
	if err := validateScheduledTaskPayload(in.TaskType, in.Payload); err != nil {
		return ScheduledTaskDTO{}, err
	}
	now := time.Now().UTC()
	t := &domain.ScheduledTask{
		ID: uuid.New(), UserID: userID,
		Name: strings.TrimSpace(in.Name), Description: strings.TrimSpace(in.Description),
		TaskType: in.TaskType, Payload: in.Payload,
		CronExpr: strings.TrimSpace(in.CronExpr), Timezone: tz,
		Active: in.Active, CreatedAt: now, UpdatedAt: now,
	}
	if err := uc.Repo.Create(ctx, t); err != nil {
		return ScheduledTaskDTO{}, err
	}
	return toDTO(t), nil
}

// ─── GetScheduledTask ─────────────────────────────────────────────────────────

type GetScheduledTask struct {
	Repo ports.ScheduledTaskRepository
}

func (uc *GetScheduledTask) Execute(ctx context.Context, id, userID uuid.UUID) (ScheduledTaskDTO, error) {
	t, err := uc.Repo.GetByID(ctx, id, userID)
	if err != nil {
		return ScheduledTaskDTO{}, err
	}
	return toDTO(t), nil
}

// ─── ListScheduledTasks ───────────────────────────────────────────────────────

type ListScheduledTasks struct {
	Repo ports.ScheduledTaskRepository
}

func (uc *ListScheduledTasks) Execute(ctx context.Context, userID uuid.UUID) ([]ScheduledTaskDTO, error) {
	tasks, err := uc.Repo.ListByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]ScheduledTaskDTO, len(tasks))
	for i := range tasks {
		out[i] = toDTO(&tasks[i])
	}
	return out, nil
}

// ─── UpdateScheduledTask ──────────────────────────────────────────────────────

type UpdateScheduledTask struct {
	Repo ports.ScheduledTaskRepository
}

type UpdateInput struct {
	Name        string
	Description string
	TaskType    domain.TaskType
	Payload     map[string]any
	CronExpr    string
	Timezone    string
	Active      bool
}

func (uc *UpdateScheduledTask) Execute(ctx context.Context, id, userID uuid.UUID, in UpdateInput) (ScheduledTaskDTO, error) {
	t, err := uc.Repo.GetByID(ctx, id, userID)
	if err != nil {
		return ScheduledTaskDTO{}, err
	}
	if strings.TrimSpace(in.Name) != "" {
		t.Name = strings.TrimSpace(in.Name)
	}
	t.Description = strings.TrimSpace(in.Description)
	if in.TaskType != "" {
		t.TaskType = in.TaskType
	}
	if in.Payload != nil {
		t.Payload = in.Payload
	}
	if strings.TrimSpace(in.CronExpr) != "" {
		t.CronExpr = strings.TrimSpace(in.CronExpr)
	}
	if strings.TrimSpace(in.Timezone) != "" {
		t.Timezone = strings.TrimSpace(in.Timezone)
	}
	t.Active = in.Active
	if err := validateScheduledTaskPayload(t.TaskType, t.Payload); err != nil {
		return ScheduledTaskDTO{}, err
	}
	if err := uc.Repo.Update(ctx, t); err != nil {
		return ScheduledTaskDTO{}, err
	}
	return toDTO(t), nil
}

// ─── DeleteScheduledTask ──────────────────────────────────────────────────────

type DeleteScheduledTask struct {
	Repo ports.ScheduledTaskRepository
}

func (uc *DeleteScheduledTask) Execute(ctx context.Context, id, userID uuid.UUID) error {
	return uc.Repo.Delete(ctx, id, userID)
}

// ─── ScheduledTaskBrief para o contexto do agente ────────────────────────────

type ScheduledTaskBrief struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	TaskType string `json:"task_type"`
	CronExpr string `json:"cron_expr"`
	Timezone string `json:"timezone"`
	Active   bool   `json:"active"`
}

func ToBriefs(tasks []domain.ScheduledTask) []ScheduledTaskBrief {
	out := make([]ScheduledTaskBrief, len(tasks))
	for i, t := range tasks {
		out[i] = ScheduledTaskBrief{
			ID: t.ID.String(), Name: t.Name,
			TaskType: string(t.TaskType), CronExpr: t.CronExpr,
			Timezone: t.Timezone, Active: t.Active,
		}
	}
	return out
}
