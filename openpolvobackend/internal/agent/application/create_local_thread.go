package application

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

// CreateLocalThread gera um identificador opaco compatível com o antigo thread LangGraph (go-local:uuid).
type CreateLocalThread struct{}

func (CreateLocalThread) Execute(ctx context.Context) (string, error) {
	_ = ctx
	id := uuid.New()
	return fmt.Sprintf("go-local:%s", id.String()), nil
}
