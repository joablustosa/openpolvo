package ports

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/open-polvo/open-polvo/internal/finance/domain"
)

type CategoryRepository interface {
	CreateCategory(ctx context.Context, c *domain.Category) error
	UpdateCategory(ctx context.Context, c *domain.Category) error
	DeleteCategory(ctx context.Context, id, userID uuid.UUID) error
	ListCategoriesByUser(ctx context.Context, userID uuid.UUID) ([]domain.Category, error)
	GetCategory(ctx context.Context, id, userID uuid.UUID) (*domain.Category, error)
}

type TransactionRepository interface {
	CreateTransaction(ctx context.Context, t *domain.Transaction) error
	DeleteTransaction(ctx context.Context, id, userID uuid.UUID) error
	ListTransactionsByRange(ctx context.Context, userID uuid.UUID, from, to time.Time, direction *domain.Direction) ([]domain.Transaction, error)
	SumByCategoryMonth(ctx context.Context, userID uuid.UUID, monthStart, monthEnd time.Time) ([]CategorySumRow, error)
	ListRecentTransactions(ctx context.Context, userID uuid.UUID, limit int) ([]domain.Transaction, error)
}

type CategorySumRow struct {
	CategoryID   *uuid.UUID
	CategoryName string
	Direction      domain.Direction
	SumMinor       int64
}

type SubscriptionRepository interface {
	CreateSubscription(ctx context.Context, s *domain.Subscription) error
	UpdateSubscription(ctx context.Context, s *domain.Subscription) error
	DeleteSubscription(ctx context.Context, id, userID uuid.UUID) error
	ListSubscriptionsByUser(ctx context.Context, userID uuid.UUID) ([]domain.Subscription, error)
	GetSubscription(ctx context.Context, id, userID uuid.UUID) (*domain.Subscription, error)
	ListActiveDueOnOrBefore(ctx context.Context, userID uuid.UUID, t time.Time) ([]domain.Subscription, error)
}

type DigestRepository interface {
	GetDigestSettings(ctx context.Context, userID uuid.UUID) (*domain.DigestSettings, error)
	UpsertDigestSettings(ctx context.Context, d *domain.DigestSettings) error
	ListDigestEnabled(ctx context.Context) ([]domain.DigestSettings, error)
}
