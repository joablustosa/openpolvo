package application

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/identity/domain"
	"github.com/open-polvo/open-polvo/internal/identity/ports"
)

type RegisterCommand struct {
	Email    string
	Password string
}

type Register struct {
	Users  ports.UserRepository
	Hasher ports.PasswordHasher
	Tokens ports.TokenIssuer
}

func (r *Register) Execute(ctx context.Context, cmd RegisterCommand) (LoginResult, error) {
	email := domain.NormalizeEmail(cmd.Email)
	if err := domain.ValidateEmail(email); err != nil {
		return LoginResult{}, err
	}
	if err := domain.ValidatePasswordPlain(cmd.Password); err != nil {
		return LoginResult{}, err
	}
	_, err := r.Users.GetByEmail(ctx, email)
	if err == nil {
		return LoginResult{}, domain.ErrEmailTaken
	}
	if !errors.Is(err, ports.ErrNotFound) {
		return LoginResult{}, err
	}
	hash, err := r.Hasher.Hash(cmd.Password)
	if err != nil {
		return LoginResult{}, err
	}
	now := time.Now().UTC()
	u := &domain.User{
		ID:           uuid.New(),
		Email:        email,
		PasswordHash: hash,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := r.Users.Create(ctx, u); err != nil {
		return LoginResult{}, err
	}
	tok, err := r.Tokens.IssueAccessToken(u.ID, u.Email)
	if err != nil {
		return LoginResult{}, err
	}
	expiresIn := int64(time.Until(tok.ExpiresAt).Seconds())
	if expiresIn < 0 {
		expiresIn = 0
	}
	return LoginResult{
		AccessToken: tok.Token,
		ExpiresIn:   expiresIn,
		TokenType:   "Bearer",
	}, nil
}
