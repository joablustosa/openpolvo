package application

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	agentports "github.com/open-polvo/open-polvo/internal/agent/ports"
	"github.com/open-polvo/open-polvo/internal/conversations/domain"
	mailapp "github.com/open-polvo/open-polvo/internal/mail/application"
	"github.com/open-polvo/open-polvo/internal/scheduledtasks/ports"
	scheddom "github.com/open-polvo/open-polvo/internal/scheduledtasks/domain"
	tasklistsapp "github.com/open-polvo/open-polvo/internal/tasklists/application"
	wfapp "github.com/open-polvo/open-polvo/internal/workflows/application"
)

// ContextLoaders agrega os carregadores de contexto para o agente.
type ContextLoaders struct {
	SMTP       func(ctx context.Context, userID uuid.UUID) *agentports.SMTPContext
	Contacts   func(ctx context.Context, userID uuid.UUID) []agentports.ContactBrief
	TaskLists  func(ctx context.Context, userID uuid.UUID) []agentports.TaskListBrief
	Finance    func(ctx context.Context, userID uuid.UUID) *agentports.FinanceContext
	Meta       func(ctx context.Context, userID uuid.UUID) *agentports.MetaContext
}

// Runner executa tarefas agendadas quando o CRON dispara.
type Runner struct {
	Repo         ports.ScheduledTaskRepository
	Agent        agentports.ChatOrchestrator
	Mail         *mailapp.SendUserEmail
	RunTaskList  *tasklistsapp.RunTaskList
	Loaders      ContextLoaders
	Log          *slog.Logger
}

// Start arranca o loop do scheduler; corre até ctx ser cancelado.
func (r *Runner) Start(ctx context.Context, checkInterval time.Duration) {
	if checkInterval < 30*time.Second {
		checkInterval = time.Minute
	}
	log := r.Log
	if log == nil {
		log = slog.Default()
	}
	log.Info("scheduled-tasks runner started", "interval", checkInterval.String())
	t := time.NewTicker(checkInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			log.Info("scheduled-tasks runner stopped")
			return
		case <-t.C:
			r.runOnce(context.Background(), log)
		}
	}
}

func (r *Runner) runOnce(ctx context.Context, log *slog.Logger) {
	tasks, err := r.Repo.ListActive(ctx)
	if err != nil {
		log.Error("scheduled-tasks list", "err", err)
		return
	}
	now := time.Now().UTC()
	for i := range tasks {
		task := &tasks[i]
		due, err := wfapp.ScheduleIsDue(task.CronExpr, task.Timezone, task.LastRunAt, task.CreatedAt, now)
		if err != nil {
			log.Warn("scheduled-tasks cron parse", "id", task.ID, "err", err)
			continue
		}
		if !due {
			continue
		}
		log.Info("scheduled-tasks firing", "id", task.ID, "name", task.Name, "type", task.TaskType)
		taskCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		result, runErr := r.execute(taskCtx, task, log)
		cancel()
		errStr := ""
		if runErr != nil {
			errStr = runErr.Error()
			log.Error("scheduled-tasks exec", "id", task.ID, "err", runErr)
		}
		if terr := r.Repo.TouchLastRun(ctx, task.ID, truncate(result, 1000), truncate(errStr, 500), time.Now().UTC()); terr != nil {
			log.Warn("scheduled-tasks touch", "id", task.ID, "err", terr)
		}
	}
}

func (r *Runner) execute(ctx context.Context, task *scheddom.ScheduledTask, log *slog.Logger) (string, error) {
	switch task.TaskType {
	case scheddom.TaskTypeAgentPrompt:
		return r.executeAgentPrompt(ctx, task, log)
	case scheddom.TaskTypeRunTaskList:
		return r.executeRunTaskList(ctx, task, log)
	default:
		return "", fmt.Errorf("task_type desconhecido: %s", task.TaskType)
	}
}

// executeAgentPrompt chama o agente Python com o prompt configurado e opcionalmente envia o resultado por email.
func (r *Runner) executeAgentPrompt(ctx context.Context, task *scheddom.ScheduledTask, log *slog.Logger) (string, error) {
	if r.Agent == nil {
		return "", fmt.Errorf("agente não configurado")
	}
	payloadRaw, _ := json.Marshal(task.Payload)
	var p scheddom.AgentPromptPayload
	if err := json.Unmarshal(payloadRaw, &p); err != nil {
		return "", fmt.Errorf("payload inválido: %w", err)
	}
	if strings.TrimSpace(p.Prompt) == "" {
		return "", fmt.Errorf("prompt vazio")
	}

	in := agentports.ReplyInput{
		Messages:      []domain.Message{{Role: "user", Content: p.Prompt}},
		ModelProvider: domain.ModelProvider("openai"),
	}
	if r.Loaders.SMTP != nil {
		in.SMTP = r.Loaders.SMTP(ctx, task.UserID)
	}
	if r.Loaders.Contacts != nil {
		in.Contacts = r.Loaders.Contacts(ctx, task.UserID)
	}
	if p.IncludeTasks && r.Loaders.TaskLists != nil {
		in.TaskLists = r.Loaders.TaskLists(ctx, task.UserID)
	}
	if p.IncludeFinance && r.Loaders.Finance != nil {
		in.Finance = r.Loaders.Finance(ctx, task.UserID)
	}
	if r.Loaders.Meta != nil {
		in.Meta = r.Loaders.Meta(ctx, task.UserID)
	}

	text, _, err := r.Agent.Reply(ctx, in)
	if err != nil {
		return "", fmt.Errorf("agente: %w", err)
	}

	if p.SendEmail && r.Mail != nil {
		subj := strings.TrimSpace(p.EmailSubject)
		if subj == "" {
			subj = fmt.Sprintf("Open Polvo — %s", task.Name)
		}
		loc, _ := time.LoadLocation(task.Timezone)
		if loc == nil {
			loc = time.UTC
		}
		subj = fmt.Sprintf("%s (%s)", subj, time.Now().In(loc).Format("02/01 15:04"))
		body := fmt.Sprintf("%s\n\n---\nGerado automaticamente pelo agente Open Polvo (%s)\n", text, task.Name)
		if merr := r.Mail.Execute(ctx, task.UserID, mailapp.SendUserEmailInput{
			Subject: subj,
			Body:    body,
		}); merr != nil {
			log.Warn("scheduled-tasks email", "id", task.ID, "err", merr)
		}
	}
	return truncate(text, 1000), nil
}

// executeRunTaskList executa uma task list persistida pelo executor do agente.
func (r *Runner) executeRunTaskList(ctx context.Context, task *scheddom.ScheduledTask, log *slog.Logger) (string, error) {
	if r.RunTaskList == nil {
		return "", fmt.Errorf("executor de listas não configurado")
	}
	payloadRaw, _ := json.Marshal(task.Payload)
	var p scheddom.RunTaskListPayload
	if err := json.Unmarshal(payloadRaw, &p); err != nil {
		return "", fmt.Errorf("payload inválido: %w", err)
	}
	listID, err := uuid.Parse(strings.TrimSpace(p.TaskListID))
	if err != nil {
		return "", fmt.Errorf("task_list_id inválido: %w", err)
	}
	if _, err := r.RunTaskList.Execute(ctx, task.UserID, listID); err != nil {
		return "", fmt.Errorf("run_task_list: %w", err)
	}
	name := p.TaskListName
	if name == "" {
		name = listID.String()
	}
	return fmt.Sprintf("lista '%s' iniciada", name), nil
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}
