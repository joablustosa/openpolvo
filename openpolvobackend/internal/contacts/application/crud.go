package application

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/contacts/domain"
	"github.com/open-polvo/open-polvo/internal/contacts/ports"
)

const (
	maxNameLen  = 255
	maxPhoneLen = 64
	maxEmailLen = 320
)

type ListContacts struct {
	Repo ports.ContactRepository
}

func (uc *ListContacts) Execute(ctx context.Context, userID uuid.UUID) ([]domain.Contact, error) {
	return uc.Repo.ListByUser(ctx, userID)
}

type CreateContact struct {
	Repo ports.ContactRepository
}

type CreateContactInput struct {
	Name  string
	Phone string
	Email string
}

func (uc *CreateContact) Execute(ctx context.Context, userID uuid.UUID, in CreateContactInput) (*domain.Contact, error) {
	name := strings.TrimSpace(in.Name)
	email := strings.TrimSpace(strings.ToLower(in.Email))
	phone := strings.TrimSpace(in.Phone)
	if err := validateContactFields(name, phone, email); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	c := &domain.Contact{
		ID:        uuid.New().String(),
		UserID:    userID.String(),
		Name:      name,
		Phone:     phone,
		Email:     email,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := uc.Repo.Create(ctx, c); err != nil {
		return nil, err
	}
	return c, nil
}

type UpdateContact struct {
	Repo ports.ContactRepository
}

type UpdateContactInput struct {
	Name  string
	Phone string
	Email string
}

func (uc *UpdateContact) Execute(ctx context.Context, userID, id uuid.UUID, in UpdateContactInput) error {
	name := strings.TrimSpace(in.Name)
	email := strings.TrimSpace(strings.ToLower(in.Email))
	phone := strings.TrimSpace(in.Phone)
	if err := validateContactFields(name, phone, email); err != nil {
		return err
	}
	existing, err := uc.Repo.GetByIDAndUser(ctx, id, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrContactNotFound
		}
		return err
	}
	existing.Name = name
	existing.Phone = phone
	existing.Email = email
	if err := uc.Repo.Update(ctx, existing); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrContactNotFound
		}
		return err
	}
	return nil
}

type DeleteContact struct {
	Repo ports.ContactRepository
}

func (uc *DeleteContact) Execute(ctx context.Context, userID, id uuid.UUID) error {
	if err := uc.Repo.Delete(ctx, id, userID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrContactNotFound
		}
		return err
	}
	return nil
}

type GetContact struct {
	Repo ports.ContactRepository
}

func (uc *GetContact) Execute(ctx context.Context, userID, id uuid.UUID) (*domain.Contact, error) {
	c, err := uc.Repo.GetByIDAndUser(ctx, id, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrContactNotFound
		}
		return nil, err
	}
	return c, nil
}

func validateContactFields(name, phone, email string) error {
	if name == "" {
		return errors.New("nome é obrigatório")
	}
	if utf8.RuneCountInString(name) > maxNameLen {
		return errors.New("nome demasiado longo")
	}
	if email == "" {
		return errors.New("email é obrigatório")
	}
	if utf8.RuneCountInString(email) > maxEmailLen || !strings.Contains(email, "@") {
		return errors.New("email inválido")
	}
	if utf8.RuneCountInString(phone) > maxPhoneLen {
		return errors.New("telefone demasiado longo")
	}
	return nil
}

// ErrContactNotFound quando o contacto não existe ou não pertence ao utilizador.
var ErrContactNotFound = errors.New("contacto não encontrado")
