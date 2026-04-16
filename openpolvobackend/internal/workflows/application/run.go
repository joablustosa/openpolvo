package application

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/conversations/domain"
	wfdomain "github.com/open-polvo/open-polvo/internal/workflows/domain"
	"github.com/open-polvo/open-polvo/internal/workflows/engine"
	"github.com/open-polvo/open-polvo/internal/workflows/ports"
	wfports "github.com/open-polvo/open-polvo/internal/workflows/ports"
)

// RunWorkflow executa um workflow de forma síncrona e persiste o run.
type RunWorkflow struct {
	Workflows ports.WorkflowRepository
	Runs      ports.RunRepository
	LLM       wfports.IntelligenceService
	// ModelProvider usado para nós llm no grafo.
	DefaultModel domain.ModelProvider
	RunnerCfg    engine.RunnerConfig
}

var runSem = make(chan struct{}, 3)

// DefaultRunnerConfig lê AUTOMATION_* do ambiente.
func DefaultRunnerConfig() engine.RunnerConfig {
	cfg := engine.RunnerConfig{
		Headless:         true,
		DefaultTimeoutMs: 30000,
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("AUTOMATION_HEADLESS")), "false") {
		cfg.Headless = false
	}
	if v := strings.TrimSpace(os.Getenv("AUTOMATION_ENABLED")); v != "" {
		cfg.AutomationOff = !parseBool(v)
	} else {
		cfg.AutomationOff = false
	}
	if s := strings.TrimSpace(os.Getenv("AUTOMATION_ALLOWED_HOSTS")); s != "" {
		for _, h := range strings.Split(s, ",") {
			h = strings.TrimSpace(h)
			if h != "" {
				cfg.ExtraHosts = append(cfg.ExtraHosts, h)
			}
		}
	}
	return cfg
}

func parseBool(s string) bool {
	return s == "1" || strings.EqualFold(s, "true") || strings.EqualFold(s, "yes")
}

func (uc *RunWorkflow) Execute(ctx context.Context, userID, workflowID uuid.UUID) (*wfdomain.WorkflowRun, error) {
	wf, err := uc.Workflows.GetByIDAndUser(ctx, workflowID, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrWorkflowNotFound
		}
		return nil, err
	}

	run := &wfdomain.WorkflowRun{
		ID:         uuid.New(),
		WorkflowID: workflowID,
		UserID:     userID,
		Status:     wfdomain.RunPending,
		CreatedAt:  time.Now().UTC(),
	}
	if err := uc.Runs.Create(ctx, run); err != nil {
		return nil, err
	}

	select {
	case runSem <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	defer func() { <-runSem }()

	run.Status = wfdomain.RunRunning
	_ = uc.Runs.Update(ctx, run)

	cfg := uc.RunnerCfg
	if cfg.DefaultTimeoutMs == 0 {
		cfg = DefaultRunnerConfig()
	}

	mp := uc.DefaultModel
	if mp == "" {
		mp = domain.ModelOpenAI
	}

	var llmFn engine.LLMInvoker
	if uc.LLM != nil {
		llmFn = func(c context.Context, prompt string) (string, error) {
			sys := "És um assistente que devolve respostas curtas e úteis para automação."
			return uc.LLM.GenerateText(c, mp, sys, prompt)
		}
	}

	logs, runErr := engine.RunGraph(ctx, wf.Graph, cfg, llmFn)
	now := time.Now().UTC()
	run.FinishedAt = &now
	run.StepLog = logs
	if runErr != nil {
		run.Status = wfdomain.RunFailed
		s := runErr.Error()
		run.ErrorMessage = &s
	} else {
		run.Status = wfdomain.RunSuccess
	}
	if uerr := uc.Runs.Update(ctx, run); uerr != nil {
		return run, uerr
	}
	// Erro de execução do grafo fica em run.status / error_message; HTTP 200 com corpo.
	return run, nil
}
