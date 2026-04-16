package application

import (
	"context"

	"github.com/google/uuid"

	agentports "github.com/open-polvo/open-polvo/internal/agent/ports"
	"github.com/open-polvo/open-polvo/internal/contacts/ports"
)

// ContactsReplyLoader monta a lista de contactos para o agente (sem dados sensíveis extra).
type ContactsReplyLoader struct {
	Repo ports.ContactRepository
	// Max lista enviada ao LLM (defeito 80).
	Max int
}

func (l *ContactsReplyLoader) ForReply(ctx context.Context, userID uuid.UUID) []agentports.ContactBrief {
	if l == nil || l.Repo == nil {
		return nil
	}
	max := l.Max
	if max <= 0 {
		max = 80
	}
	list, err := l.Repo.ListByUser(ctx, userID)
	if err != nil || len(list) == 0 {
		return nil
	}
	if len(list) > max {
		list = list[:max]
	}
	out := make([]agentports.ContactBrief, 0, len(list))
	for _, c := range list {
		out = append(out, agentports.ContactBrief{
			ID:    c.ID,
			Name:  c.Name,
			Phone: c.Phone,
			Email: c.Email,
		})
	}
	return out
}
