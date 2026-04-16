package ports

import (
	"context"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/contacts/domain"
)

// ContactRepository persistência de contactos por utilizador.
type ContactRepository interface {
	ListByUser(ctx context.Context, userID uuid.UUID) ([]domain.Contact, error)
	GetByIDAndUser(ctx context.Context, id, userID uuid.UUID) (*domain.Contact, error)
	Create(ctx context.Context, c *domain.Contact) error
	Update(ctx context.Context, c *domain.Contact) error
	Delete(ctx context.Context, id, userID uuid.UUID) error
}
