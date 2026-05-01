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

// Ensure garante que o admin existe e tem a password correcta do env.
//
// Comportamento:
//   - Se o utilizador não existe: cria-o (created=true).
//   - Se o utilizador já existe: actualiza o hash da password para corresponder ao env (created=false).
//
// Isto garante que, após uma reinstalação ou redefinição, a password do admin
// corresponde SEMPRE à que está no backend.env — mesmo que a BD não tenha sido apagada.
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
	hash, err := b.Hasher.Hash(password)
	if err != nil {
		return false, err
	}
	_, err = b.Users.GetByEmail(ctx, em)
	if err == nil {
		// Utilizador já existe — actualiza password para sincronizar com o env.
		// Essencial após reinstalação sem apagar a BD (evita "invalid credentials").
		return false, b.Users.UpdatePasswordHash(ctx, em, hash)
	}
	if !errors.Is(err, ports.ErrNotFound) {
		return false, err
	}
	// Utilizador não existe — cria-o.
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
