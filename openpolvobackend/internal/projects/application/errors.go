package application

import "errors"

var (
	// ErrNotFound indica que o projeto/versão pedido não existe.
	ErrNotFound = errors.New("projects: não encontrado")
	// ErrInvalidInput indica dados de entrada inválidos.
	ErrInvalidInput = errors.New("projects: dados inválidos")
)
