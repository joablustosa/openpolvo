package ports

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/schedulequeue/domain"
)

type Repository interface {
	// Enqueue tenta inserir item na fila. Deve ser idempotente (dedupe por UNIQUE).
	// Retorna inserted=true se entrou; false se já existia.
	Enqueue(ctx context.Context, it domain.Item) (inserted bool, err error)

	// ClaimNext faz lock de um item due (scheduled_for <= now) e devolve para execução.
	// Se não houver nada, devolve (nil, nil).
	ClaimNext(ctx context.Context, now time.Time, lockTTL time.Duration) (*domain.Item, error)

	MarkDone(ctx context.Context, id uuid.UUID, finishedAt time.Time) error
	MarkError(ctx context.Context, id uuid.UUID, errMsg string, finishedAt time.Time) error
}

