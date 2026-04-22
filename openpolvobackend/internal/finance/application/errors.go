package application

import "errors"

var (
	ErrNotFound       = errors.New("finance: não encontrado")
	ErrInvalidInput   = errors.New("finance: dados inválidos")
	ErrCategoryInUse  = errors.New("finance: categoria em uso")
)
