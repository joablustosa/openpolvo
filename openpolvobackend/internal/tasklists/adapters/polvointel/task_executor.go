package polvointel

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/open-polvo/open-polvo/internal/agent/adapters/polvointel"
	"github.com/open-polvo/open-polvo/internal/conversations/domain"
	"github.com/open-polvo/open-polvo/internal/tasklists/ports"
)

// TaskExecutorClient implementa ports.TaskExecutor chamando o serviço Python
// via GenerateText (endpoint /v1/llm/generate-text).
type TaskExecutorClient struct {
	client *polvointel.Client
}

// NewTaskExecutorClient devolve nil se baseURL ou internalKey estiverem vazios
// (mesmo padrão do polvointel.New).
func NewTaskExecutorClient(baseURL, internalKey string, timeout time.Duration) *TaskExecutorClient {
	c := polvointel.New(baseURL, internalKey, timeout)
	if c == nil {
		return nil
	}
	return &TaskExecutorClient{client: c}
}

var _ ports.TaskExecutor = (*TaskExecutorClient)(nil)

func (e *TaskExecutorClient) ExecuteTask(ctx context.Context, req ports.TaskExecutionRequest) (ports.TaskExecutionResult, error) {
	if e == nil || e.client == nil {
		return ports.TaskExecutionResult{}, fmt.Errorf("task executor: cliente não configurado")
	}

	mp := domain.ModelProvider(req.ModelProvider)
	if mp == "" {
		mp = domain.ModelOpenAI
	}

	sys := "És um agente executor de tarefas. Executa a tarefa descrita pelo utilizador e devolve o resultado de forma clara, completa e em português."

	user := fmt.Sprintf("Tarefa: %s", strings.TrimSpace(req.TaskTitle))
	if d := strings.TrimSpace(req.TaskDescription); d != "" {
		user += fmt.Sprintf("\n\nDetalhes: %s", d)
	}

	text, err := e.client.GenerateText(ctx, mp, sys, user)
	if err != nil {
		return ports.TaskExecutionResult{}, fmt.Errorf("task executor: %w", err)
	}
	return ports.TaskExecutionResult{ResultText: text}, nil
}
