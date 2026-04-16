package domain

import (
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrEmailTaken         = errors.New("email already registered")
	ErrWeakPassword       = errors.New("password must be at least 8 characters")
	ErrInvalidEmail       = errors.New("invalid email")
)

const minPasswordLen = 8

type User struct {
	ID           uuid.UUID
	Email        string
	PasswordHash string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

func NormalizeEmail(email string) string {
	return strings.TrimSpace(strings.ToLower(email))
}

func ValidatePasswordPlain(plain string) error {
	if len(strings.TrimSpace(plain)) < minPasswordLen {
		return ErrWeakPassword
	}
	return nil
}

func ValidateEmail(email string) error {
	e := NormalizeEmail(email)
	if e == "" || !strings.Contains(e, "@") {
		return ErrInvalidEmail
	}
	return nil
}
