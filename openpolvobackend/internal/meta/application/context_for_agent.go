package application

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"

	agentports "github.com/open-polvo/open-polvo/internal/agent/ports"
	"github.com/open-polvo/open-polvo/internal/meta/ports"
)

// MetaContextLoader expõe metadados Meta ao orquestrador (sem tokens).
type MetaContextLoader struct {
	Repo ports.MetaSettingsRepository
}

func (l *MetaContextLoader) ForReply(ctx context.Context, userID uuid.UUID) *agentports.MetaContext {
	if l == nil || l.Repo == nil {
		return nil
	}
	rec, err := l.Repo.GetByUserID(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return &agentports.MetaContext{}
		}
		return nil
	}
	return &agentports.MetaContext{
		WhatsAppConfigured:  rec.WAPhoneNumberID != "" && len(rec.WAAccessTokenEnc) > 0,
		FacebookConfigured:  rec.FBPageID != "" && len(rec.FBPageTokenEnc) > 0,
		InstagramConfigured: rec.IGAccountID != "" && len(rec.IGAccessTokenEnc) > 0,
		WAPhoneNumberID:     rec.WAPhoneNumberID,
		FBPageID:            rec.FBPageID,
		IGAccountID:         rec.IGAccountID,
	}
}
