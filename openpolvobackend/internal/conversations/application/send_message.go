package application

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	agentports "github.com/open-polvo/open-polvo/internal/agent/ports"
	"github.com/open-polvo/open-polvo/internal/conversations/domain"
	convports "github.com/open-polvo/open-polvo/internal/conversations/ports"
)

type SendMessageCommand struct {
	UserID         uuid.UUID
	ConversationID uuid.UUID
	Text           string
	ModelProvider  domain.ModelProvider
}

type SendMessage struct {
	Conversations convports.ConversationRepository
	Messages      convports.MessageRepository
	Agent         agentports.ChatOrchestrator
}

func (s *SendMessage) Execute(ctx context.Context, cmd SendMessageCommand) ([]domain.Message, error) {
	if s.Agent == nil {
		return nil, convports.ErrAgentDisabled
	}
	text := strings.TrimSpace(cmd.Text)
	if text == "" {
		return nil, convports.ErrEmptyMessage
	}
	conv, err := s.Conversations.GetByIDAndUser(ctx, cmd.ConversationID, cmd.UserID)
	if err != nil {
		return nil, err
	}
	model := cmd.ModelProvider
	if model == "" {
		model = conv.DefaultModel
	}
	now := time.Now().UTC()
	userMsg := domain.Message{
		ID:             uuid.New(),
		ConversationID: conv.ID,
		Role:           "user",
		Content:        text,
		CreatedAt:      now,
	}
	if err := s.Messages.Create(ctx, &userMsg); err != nil {
		return nil, err
	}
	hist, err := s.Messages.ListByConversation(ctx, conv.ID)
	if err != nil {
		return nil, err
	}
	assistantText, meta, err := s.Agent.Reply(ctx, agentports.ReplyInput{
		Messages:      hist,
		ModelProvider: model,
	})
	if err != nil {
		if errors.Is(err, convports.ErrModelNotConfigured) {
			metaBytes, _ := json.Marshal(map[string]any{"error": err.Error()})
			_ = s.Messages.Create(ctx, &domain.Message{
				ID:             uuid.New(),
				ConversationID: conv.ID,
				Role:           "assistant",
				Content:        "Não há chave de API no serviço Open Polvo Intelligence para o fornecedor de modelo seleccionado. Defina OPENAI_API_KEY e/ou GOOGLE_API_KEY no ambiente do serviço Python.",
				Metadata:       metaBytes,
				CreatedAt:      time.Now().UTC(),
			})
			_ = s.Conversations.TouchUpdatedAt(ctx, conv.ID, time.Now().UTC())
			return s.Messages.ListByConversation(ctx, conv.ID)
		}
		metaBytes, _ := json.Marshal(map[string]any{"error": err.Error()})
		_ = s.Messages.Create(ctx, &domain.Message{
			ID:             uuid.New(),
			ConversationID: conv.ID,
			Role:           "assistant",
			Content:        "Não foi possível obter resposta do agente. Verifique o serviço Open Polvo Intelligence, POLVO_INTELLIGENCE_* na API Go e a ligação à rede.",
			Metadata:       metaBytes,
			CreatedAt:      time.Now().UTC(),
		})
		_ = s.Conversations.TouchUpdatedAt(ctx, conv.ID, time.Now().UTC())
		return s.Messages.ListByConversation(ctx, conv.ID)
	}
	metaBytes, err := json.Marshal(meta)
	if err != nil {
		metaBytes = nil
	}
	_ = s.Messages.Create(ctx, &domain.Message{
		ID:             uuid.New(),
		ConversationID: conv.ID,
		Role:           "assistant",
		Content:        assistantText,
		Metadata:       metaBytes,
		CreatedAt:      time.Now().UTC(),
	})
	_ = s.Conversations.TouchUpdatedAt(ctx, conv.ID, time.Now().UTC())
	if conv.Title == nil || strings.TrimSpace(*conv.Title) == "" {
		title := text
		if len([]rune(title)) > 80 {
			title = string([]rune(title)[:80]) + "…"
		}
		_ = s.Conversations.UpdateTitle(ctx, conv.ID, cmd.UserID, title)
	}
	return s.Messages.ListByConversation(ctx, conv.ID)
}
