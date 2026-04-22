package application

import (
	"bufio"
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"

	agentports "github.com/open-polvo/open-polvo/internal/agent/ports"
	"github.com/open-polvo/open-polvo/internal/conversations/domain"
	convports "github.com/open-polvo/open-polvo/internal/conversations/ports"
)

// StreamMessageCommand é igual a SendMessageCommand mas para o fluxo SSE.
type StreamMessageCommand struct {
	UserID         uuid.UUID
	ConversationID uuid.UUID
	Text           string
	ModelProvider  domain.ModelProvider
}

// StreamEvent é o evento SSE deserializado do Python.
type StreamEvent struct {
	Type          string         `json:"type"`
	Step          string         `json:"step,omitempty"`
	Label         string         `json:"label,omitempty"`
	Node          string         `json:"node,omitempty"`
	Detail        string         `json:"detail,omitempty"`
	File          map[string]any `json:"file,omitempty"`
	AssistantText string         `json:"assistant_text,omitempty"`
	Metadata      map[string]any `json:"metadata,omitempty"`
	Artifact      map[string]any `json:"artifact,omitempty"`
}

// StreamMessage orquestra o fluxo SSE: guarda a mensagem do utilizador, abre o
// stream Python e devolve um canal de eventos + função de cleanup.
type StreamMessage struct {
	Conversations   convports.ConversationRepository
	Messages        convports.MessageRepository
	Streamer        agentports.ChatStreamer
	SMTPForReply      func(ctx context.Context, userID uuid.UUID) *agentports.SMTPContext
	ContactsForReply  func(ctx context.Context, userID uuid.UUID) []agentports.ContactBrief
	TaskListsForReply func(ctx context.Context, userID uuid.UUID) []agentports.TaskListBrief
	FinanceForReply   func(ctx context.Context, userID uuid.UUID) *agentports.FinanceContext
	MetaForReply           func(ctx context.Context, userID uuid.UUID) *agentports.MetaContext
	ScheduledTasksForReply func(ctx context.Context, userID uuid.UUID) []agentports.ScheduledTaskBrief
}

// StreamResult contém a conversa, histórico e um scanner do stream Python.
type StreamResult struct {
	Conv    domain.Conversation
	History []domain.Message
	Scanner *bufio.Scanner
	Cleanup func()
}

// Prepare guarda a mensagem do utilizador, carrega o histórico e abre o stream Python.
func (s *StreamMessage) Prepare(ctx context.Context, cmd StreamMessageCommand) (*StreamResult, error) {
	if s.Streamer == nil {
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
	userMsg := domain.Message{
		ID:             uuid.New(),
		ConversationID: conv.ID,
		Role:           "user",
		Content:        text,
		CreatedAt:      time.Now().UTC(),
	}
	if err := s.Messages.Create(ctx, &userMsg); err != nil {
		return nil, err
	}
	hist, err := s.Messages.ListByConversation(ctx, conv.ID)
	if err != nil {
		return nil, err
	}
	repIn := agentports.ReplyInput{
		Messages:      hist,
		ModelProvider: model,
	}
	if s.SMTPForReply != nil {
		repIn.SMTP = s.SMTPForReply(ctx, cmd.UserID)
	}
	if s.ContactsForReply != nil {
		repIn.Contacts = s.ContactsForReply(ctx, cmd.UserID)
	}
	if s.TaskListsForReply != nil {
		repIn.TaskLists = s.TaskListsForReply(ctx, cmd.UserID)
	}
	if s.FinanceForReply != nil {
		repIn.Finance = s.FinanceForReply(ctx, cmd.UserID)
	}
	if s.MetaForReply != nil {
		repIn.Meta = s.MetaForReply(ctx, cmd.UserID)
	}
	if s.ScheduledTasksForReply != nil {
		repIn.ScheduledTasks = s.ScheduledTasksForReply(ctx, cmd.UserID)
	}
	body, err := s.Streamer.ReplyStream(ctx, repIn)
	if err != nil {
		return nil, err
	}
	return &StreamResult{
		Conv:    *conv,
		History: hist,
		Scanner: bufio.NewScanner(body),
		Cleanup: func() { _ = body.Close() },
	}, nil
}

// SaveAssistant persiste a mensagem do assistente após o stream terminar.
func (s *StreamMessage) SaveAssistant(ctx context.Context, conv domain.Conversation, text string, meta map[string]any, userID uuid.UUID, userText string) ([]domain.Message, error) {
	metaBytes, _ := json.Marshal(meta)
	_ = s.Messages.Create(ctx, &domain.Message{
		ID:             uuid.New(),
		ConversationID: conv.ID,
		Role:           "assistant",
		Content:        text,
		Metadata:       metaBytes,
		CreatedAt:      time.Now().UTC(),
	})
	_ = s.Conversations.TouchUpdatedAt(ctx, conv.ID, time.Now().UTC())
	if conv.Title == nil || strings.TrimSpace(*conv.Title) == "" {
		title := userText
		if len([]rune(title)) > 80 {
			title = string([]rune(title)[:80]) + "…"
		}
		_ = s.Conversations.UpdateTitle(ctx, conv.ID, userID, title)
	}
	return s.Messages.ListByConversation(ctx, conv.ID)
}

// SaveAssistantError persiste uma mensagem de erro do assistente.
func (s *StreamMessage) SaveAssistantError(ctx context.Context, conv domain.Conversation, detail string) {
	metaBytes, _ := json.Marshal(map[string]any{"error": detail})
	_ = s.Messages.Create(ctx, &domain.Message{
		ID:             uuid.New(),
		ConversationID: conv.ID,
		Role:           "assistant",
		Content:        "Não foi possível obter resposta do agente.\n\nDetalhe: " + detail,
		Metadata:       metaBytes,
		CreatedAt:      time.Now().UTC(),
	})
	_ = s.Conversations.TouchUpdatedAt(ctx, conv.ID, time.Now().UTC())
}
