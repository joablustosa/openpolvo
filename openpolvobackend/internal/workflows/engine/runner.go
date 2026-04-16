package engine

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/playwright-community/playwright-go"

	"github.com/open-polvo/open-polvo/internal/workflows/domain"
)

// LLMInvoker é chamado para nós tipo "llm".
type LLMInvoker func(ctx context.Context, prompt string) (string, error)

// RunnerConfig controla Playwright e segurança.
type RunnerConfig struct {
	Headless         bool
	ExtraHosts       []string
	AutomationOff    bool
	DefaultTimeoutMs int
}

// RunGraph executa o DAG com um único browser (headless por defeito).
func RunGraph(ctx context.Context, g domain.GraphJSON, cfg RunnerConfig, llm LLMInvoker) ([]domain.StepLogEntry, error) {
	if cfg.AutomationOff {
		return nil, fmt.Errorf("automação desactivada (AUTOMATION_ENABLED=false)")
	}
	if cfg.DefaultTimeoutMs <= 0 {
		cfg.DefaultTimeoutMs = 30000
	}

	order, err := OrderNodes(g)
	if err != nil {
		return nil, err
	}
	nodeByID := make(map[string]domain.GraphNode)
	for _, n := range g.Nodes {
		nodeByID[n.ID] = n
	}

	pw, err := playwright.Run()
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "install the driver") {
			return nil, fmt.Errorf("playwright: %w — na raiz do repo executa: go run github.com/playwright-community/playwright-go/cmd/playwright@v0.5700.1 install chromium", err)
		}
		return nil, fmt.Errorf("playwright: %w", err)
	}
	defer func() {
		_ = pw.Stop()
	}()

	browser, err := pw.Chromium.Launch(playwright.BrowserTypeLaunchOptions{
		Headless: playwright.Bool(cfg.Headless),
	})
	if err != nil {
		return nil, fmt.Errorf("launch chromium: %w", err)
	}
	defer func() {
		_ = browser.Close()
	}()

	page, err := browser.NewPage()
	if err != nil {
		return nil, fmt.Errorf("new page: %w", err)
	}
	defer func() {
		_ = page.Close()
	}()

	var logs []domain.StepLogEntry
	for _, id := range order {
		n := nodeByID[id]
		step := domain.StepLogEntry{NodeID: id, Type: n.Type}
		to := float64(cfg.DefaultTimeoutMs)
		if n.Data.TimeoutMs > 0 {
			to = float64(n.Data.TimeoutMs)
		}
		page.SetDefaultTimeout(to)
		page.SetDefaultNavigationTimeout(to)

		switch strings.ToLower(strings.TrimSpace(n.Type)) {
		case "schedule":
			// Metadados de agendamento (cron no servidor); execução real é pelo scheduler.
			step.OK = true
			cron := strings.TrimSpace(n.Data.Cron)
			tz := strings.TrimSpace(n.Data.Timezone)
			if tz == "" {
				tz = "UTC"
			}
			if cron != "" {
				step.Message = "agendamento: " + cron + " (" + tz + ")"
			} else {
				step.Message = "agendamento (defina cron no painel)"
			}
			logs = append(logs, step)

		case "goto":
			u := strings.TrimSpace(n.Data.URL)
			if u == "" {
				step.Message = "url vazia"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: url obrigatória", id)
			}
			if !HostAllowed(u, cfg.ExtraHosts) {
				step.Message = "url não permitida pela política"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: host não permitido", id)
			}
			if _, err := page.Goto(u); err != nil {
				step.Message = err.Error()
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("goto %s: %w", id, err)
			}
			step.OK = true
			step.Message = "ok"

		case "click":
			sel := strings.TrimSpace(n.Data.Selector)
			if sel == "" {
				step.Message = "selector vazio"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: selector obrigatório", id)
			}
			if err := page.Click(sel); err != nil {
				step.Message = err.Error()
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("click %s: %w", id, err)
			}
			step.OK = true
			step.Message = "ok"

		case "fill":
			sel := strings.TrimSpace(n.Data.Selector)
			if sel == "" {
				step.Message = "selector vazio"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: selector obrigatório", id)
			}
			val := n.Data.Value
			if err := page.Fill(sel, val); err != nil {
				step.Message = err.Error()
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("fill %s: %w", id, err)
			}
			step.OK = true
			step.Message = "ok"

		case "wait":
			sel := strings.TrimSpace(n.Data.Selector)
			if sel == "" {
				step.Message = "selector vazio"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: selector obrigatório", id)
			}
			if _, err := page.WaitForSelector(sel); err != nil {
				step.Message = err.Error()
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("wait %s: %w", id, err)
			}
			step.OK = true
			step.Message = "ok"

		case "llm":
			if llm == nil {
				step.Message = "LLM não configurado"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: llm indisponível", id)
			}
			prompt := strings.TrimSpace(n.Data.Prompt)
			if prompt == "" {
				step.Message = "prompt vazio"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: prompt obrigatório", id)
			}
			out, err := llm(ctx, prompt)
			if err != nil {
				step.Message = err.Error()
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("llm %s: %w", id, err)
			}
			step.OK = true
			if len(out) > 200 {
				step.Message = out[:200] + "…"
			} else {
				step.Message = out
			}

		default:
			step.Message = "tipo desconhecido: " + n.Type
			step.OK = false
			logs = append(logs, step)
			return logs, fmt.Errorf("tipo de nó não suportado: %s", n.Type)
		}
		logs = append(logs, step)

		select {
		case <-ctx.Done():
			return logs, ctx.Err()
		default:
		}
		time.Sleep(50 * time.Millisecond)
	}
	return logs, nil
}
