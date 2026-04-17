package ports

import "context"

// TaskExecutor executa uma tarefa individual via LLM.
type TaskExecutor interface {
	ExecuteTask(ctx context.Context, req TaskExecutionRequest) (TaskExecutionResult, error)
}

// TaskExecutionRequest descreve a tarefa a executar.
type TaskExecutionRequest struct {
	ModelProvider   string
	TaskTitle       string
	TaskDescription string
}

// TaskExecutionResult contém o resultado da execução.
type TaskExecutionResult struct {
	ResultText string
}
