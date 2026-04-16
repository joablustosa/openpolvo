package jwtissuer

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/identity/ports"
)

type Issuer struct {
	Secret []byte
	Issuer string
	TTL    time.Duration
}

type claims struct {
	Email string `json:"email"`
	jwt.RegisteredClaims
}

func (i Issuer) IssueAccessToken(userID uuid.UUID, email string) (ports.AccessToken, error) {
	now := time.Now().UTC()
	exp := now.Add(i.TTL)
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims{
		Email: email,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID.String(),
			Issuer:    i.Issuer,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(exp),
		},
	})
	s, err := t.SignedString(i.Secret)
	if err != nil {
		return ports.AccessToken{}, err
	}
	return ports.AccessToken{Token: s, ExpiresAt: exp}, nil
}

func (i Issuer) ParseAccessToken(token string) (uuid.UUID, string, error) {
	parsed, err := jwt.ParseWithClaims(token, &claims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return i.Secret, nil
	})
	if err != nil || !parsed.Valid {
		return uuid.Nil, "", errors.New("invalid token")
	}
	c, ok := parsed.Claims.(*claims)
	if !ok {
		return uuid.Nil, "", errors.New("invalid claims")
	}
	id, err := uuid.Parse(c.Subject)
	if err != nil {
		return uuid.Nil, "", err
	}
	return id, c.Email, nil
}
