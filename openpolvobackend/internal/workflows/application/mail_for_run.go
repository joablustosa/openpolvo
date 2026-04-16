package application

import (
	"context"

	"github.com/google/uuid"

	contactsapp "github.com/open-polvo/open-polvo/internal/contacts/application"
	mailapp "github.com/open-polvo/open-polvo/internal/mail/application"
	"github.com/open-polvo/open-polvo/internal/workflows/engine"
)

// MailDepsForWorkflowUser constrói dependências de envio para o utilizador dono do workflow.
func MailDepsForWorkflowUser(userID uuid.UUID, send *mailapp.SendUserEmail, get *contactsapp.GetContact) *engine.MailDeps {
	if send == nil || get == nil {
		return nil
	}
	return &engine.MailDeps{
		LookupEmail: func(ctx context.Context, contactID uuid.UUID) (string, error) {
			c, err := get.Execute(ctx, userID, contactID)
			if err != nil {
				return "", err
			}
			return c.Email, nil
		},
		Send: func(ctx context.Context, to, subject, body string) error {
			return send.Execute(ctx, userID, mailapp.SendUserEmailInput{
				To: to, Subject: subject, Body: body,
			})
		},
	}
}
