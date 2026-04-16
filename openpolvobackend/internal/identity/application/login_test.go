package application

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/identity/domain"
	"github.com/open-polvo/open-polvo/internal/identity/ports"
)

type fakeRepo struct {
	byEmail map[string]*domain.User
}

func (f *fakeRepo) GetByEmail(ctx context.Context, email string) (*domain.User, error) {
	u, ok := f.byEmail[email]
	if !ok {
		return nil, ports.ErrNotFound
	}
	return u, nil
}

func (f *fakeRepo) GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	return nil, ports.ErrNotFound
}

func (f *fakeRepo) Create(ctx context.Context, u *domain.User) error {
	if f.byEmail == nil {
		f.byEmail = make(map[string]*domain.User)
	}
	f.byEmail[u.Email] = u
	return nil
}

type fakeHasher struct{}

func (fakeHasher) Hash(plain string) (string, error) { return "hashed", nil }

func (fakeHasher) Compare(hash, plain string) bool {
	return hash == "hashed" && plain == "correct-password"
}

type fakeTokens struct{}

func (fakeTokens) IssueAccessToken(userID uuid.UUID, email string) (ports.AccessToken, error) {
	return ports.AccessToken{
		Token:     "jwt-token",
		ExpiresAt: time.Now().Add(15 * time.Minute),
	}, nil
}

func (fakeTokens) ParseAccessToken(token string) (uuid.UUID, string, error) {
	return uuid.Nil, "", nil
}

func TestLogin_Execute_success(t *testing.T) {
	id := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	repo := &fakeRepo{byEmail: map[string]*domain.User{
		"user@example.com": {
			ID:           id,
			Email:        "user@example.com",
			PasswordHash: "hashed",
		},
	}}
	uc := Login{Users: repo, Hasher: fakeHasher{}, Tokens: fakeTokens{}}
	res, err := uc.Execute(context.Background(), LoginCommand{
		Email:    "user@example.com",
		Password: "correct-password",
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.AccessToken != "jwt-token" || res.TokenType != "Bearer" || res.ExpiresIn <= 0 {
		t.Fatalf("unexpected result: %+v", res)
	}
}

func TestLogin_Execute_invalidCredentials(t *testing.T) {
	id := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	repo := &fakeRepo{byEmail: map[string]*domain.User{
		"user@example.com": {ID: id, Email: "user@example.com", PasswordHash: "hashed"},
	}}
	uc := Login{Users: repo, Hasher: fakeHasher{}, Tokens: fakeTokens{}}
	_, err := uc.Execute(context.Background(), LoginCommand{
		Email:    "user@example.com",
		Password: "wrong",
	})
	if err != domain.ErrInvalidCredentials {
		t.Fatalf("expected ErrInvalidCredentials, got %v", err)
	}
}
