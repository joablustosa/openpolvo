package ports

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/identity/domain"
)

type UserRepository interface {
	GetByEmail(ctx context.Context, email string) (*domain.User, error)
	GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error)
	Create(ctx context.Context, u *domain.User) error
}

type PasswordHasher interface {
	Hash(plain string) (string, error)
	Compare(hash, plain string) bool
}

type AccessToken struct {
	Token     string
	ExpiresAt time.Time
}

type TokenIssuer interface {
	IssueAccessToken(userID uuid.UUID, email string) (AccessToken, error)
	ParseAccessToken(token string) (userID uuid.UUID, email string, err error)
}
