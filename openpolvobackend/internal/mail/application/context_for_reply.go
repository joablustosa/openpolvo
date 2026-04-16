package application

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"

	agentports "github.com/open-polvo/open-polvo/internal/agent/ports"
	"github.com/open-polvo/open-polvo/internal/mail/ports"
)

// SMTPContextLoader expõe metadados SMTP ao orquestrador (sem password).
type SMTPContextLoader struct {
	Repo ports.SMTPSettingsRepository
}

func (l *SMTPContextLoader) ForReply(ctx context.Context, userID uuid.UUID) *agentports.SMTPContext {
	if l == nil || l.Repo == nil {
		return nil
	}
	rec, err := l.Repo.GetByUserID(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return &agentports.SMTPContext{Configured: false}
		}
		return nil
	}
	if rec.Host == "" || rec.FromEmail == "" {
		return &agentports.SMTPContext{Configured: false}
	}
	return &agentports.SMTPContext{
		Configured: true,
		FromEmail:  rec.FromEmail,
		FromName:   rec.FromName,
		Host:       rec.Host,
		Port:       rec.Port,
		UseTLS:     rec.UseTLS,
	}
}
