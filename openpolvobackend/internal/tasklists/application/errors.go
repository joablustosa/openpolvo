package application

import "errors"

var (
	ErrTaskListNotFound      = errors.New("lista de tarefas não encontrada")
	ErrTaskItemNotFound      = errors.New("item de tarefa não encontrado")
	ErrAlreadyRunning        = errors.New("lista de tarefas já está em execução")
	ErrListRunningMutation   = errors.New("lista em execução não pode ser alterada desta forma")
	ErrItemNotEditable       = errors.New("item não está pendente ou não pode ser editado")
	ErrExecutorNotConfigured = errors.New("executor de tarefas não configurado (Open Polvo Intelligence)")
)
