package application

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/identity/domain"
	"github.com/open-polvo/open-polvo/internal/identity/ports"
)

// DefaultAdminBootstrap garante um utilizador admin inicial após migrações (idempotente).
type DefaultAdminBootstrap struct {
	Users  ports.UserRepository
	Hasher ports.PasswordHasher
}

// Ensure cria o admin se ainda não existir (por email). Devolve created=true quando inseriu.
func (b *DefaultAdminBootstrap) Ensure(ctx context.Context, email, password string) (created bool, err error) {
	if email == "" || password == "" {
		return false, nil
	}
	em := domain.NormalizeEmail(email)
	if err := domain.ValidateEmail(em); err != nil {
		return false, err
	}
	if err := domain.ValidatePasswordPlain(password); err != nil {
		return false, err
	}
	_, err = b.Users.GetByEmail(ctx, em)
	if err == nil {
		return false, nil
	}
	if !errors.Is(err, ports.ErrNotFound) {
		return false, err
	}
	hash, err := b.Hasher.Hash(password)
	if err != nil {
		return false, err
	}
	now := time.Now().UTC()
	u := &domain.User{
		ID:           uuid.New(),
		Email:        em,
		PasswordHash: hash,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := b.Users.Create(ctx, u); err != nil {
		return false, err
	}
	return true, nil
}
