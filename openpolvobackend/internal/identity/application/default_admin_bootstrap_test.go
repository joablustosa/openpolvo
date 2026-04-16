package application

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/identity/domain"
)

func TestDefaultAdminBootstrap_Ensure_idempotent(t *testing.T) {
	id := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	repo := &fakeRepo{byEmail: map[string]*domain.User{
		"admin@openlaele.local": {ID: id, Email: "admin@openlaele.local", PasswordHash: "x"},
	}}
	b := DefaultAdminBootstrap{Users: repo, Hasher: fakeHasher{}}
	created, err := b.Ensure(context.Background(), "admin@openlaele.local", "correct-password")
	if err != nil {
		t.Fatal(err)
	}
	if created {
		t.Fatal("expected no second create")
	}
}

func TestDefaultAdminBootstrap_Ensure_creates(t *testing.T) {
	repo := &fakeRepo{byEmail: map[string]*domain.User{}}
	b := DefaultAdminBootstrap{Users: repo, Hasher: fakeHasher{}}
	created, err := b.Ensure(context.Background(), "new@example.com", "correct-password")
	if err != nil {
		t.Fatal(err)
	}
	if !created {
		t.Fatal("expected created")
	}
	u, err := repo.GetByEmail(context.Background(), "new@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if u.Email != "new@example.com" || u.PasswordHash != "hashed" {
		t.Fatalf("user: %+v", u)
	}
}
