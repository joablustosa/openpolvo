package application

import (
	"context"
	"errors"
	"time"

	"github.com/open-polvo/open-polvo/internal/identity/domain"
	"github.com/open-polvo/open-polvo/internal/identity/ports"
)

type LoginCommand struct {
	Email    string
	Password string
}

type LoginResult struct {
	AccessToken string
	ExpiresIn   int64
	TokenType   string
}

type Login struct {
	Users  ports.UserRepository
	Hasher ports.PasswordHasher
	Tokens ports.TokenIssuer
}

func (l *Login) Execute(ctx context.Context, cmd LoginCommand) (LoginResult, error) {
	email := domain.NormalizeEmail(cmd.Email)
	if err := domain.ValidateEmail(email); err != nil {
		return LoginResult{}, domain.ErrInvalidCredentials
	}
	u, err := l.Users.GetByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, ports.ErrNotFound) {
			return LoginResult{}, domain.ErrInvalidCredentials
		}
		return LoginResult{}, err
	}
	if !l.Hasher.Compare(u.PasswordHash, cmd.Password) {
		return LoginResult{}, domain.ErrInvalidCredentials
	}
	tok, err := l.Tokens.IssueAccessToken(u.ID, u.Email)
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
