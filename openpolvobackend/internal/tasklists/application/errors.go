package application

import "errors"

var (
	ErrTaskListNotFound      = errors.New("lista de tarefas não encontrada")
	ErrAlreadyRunning        = errors.New("lista de tarefas já está em execução")
	ErrExecutorNotConfigured = errors.New("executor de tarefas não configurado (Open Polvo Intelligence)")
)
