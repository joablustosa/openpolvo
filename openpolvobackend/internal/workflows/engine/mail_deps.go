package engine

import (
	"context"

	"github.com/google/uuid"
)

// MailDeps envio SMTP do utilizador no contexto de um run (nó send_email).
type MailDeps struct {
	LookupEmail func(ctx context.Context, contactID uuid.UUID) (to string, err error)
	Send        func(ctx context.Context, to, subject, body string) error
}
