package ports

import (
	"context"

	"github.com/open-polvo/open-polvo/internal/conversations/domain"
)

// ReplyInput contém o histórico já persistido (incluindo a última mensagem do utilizador).
type ReplyInput struct {
	Messages       []domain.Message
	ModelProvider  domain.ModelProvider
	SMTP           *SMTPContext   // opcional: conta de envio configurada na aplicação
	Contacts       []ContactBrief // opcional: agenda do utilizador (nome, email, telefone)
}

// ChatOrchestrator implementa o fluxo analisador → router → especialista (Zé Polvinho).
type ChatOrchestrator interface {
	Reply(ctx context.Context, in ReplyInput) (assistantText string, meta map[string]any, err error)
}
