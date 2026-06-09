package application

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/projects/domain"
	"github.com/open-polvo/open-polvo/internal/projects/ports"
)

// EnsureInput descreve o projeto a garantir para uma conversa.
type EnsureInput struct {
	UserID         uuid.UUID
	ConversationID uuid.UUID
	Title          string
	Kind           string
	Stack          string
}

// EnsureProjectForConversation garante que existe um projeto para a conversa,
// criando-o na primeira vez. Devolve o projeto e se foi criado agora.
type EnsureProjectForConversation struct {
	Repo ports.ProjectRepository
}

func (uc *EnsureProjectForConversation) Execute(ctx context.Context, in EnsureInput) (*domain.Project, bool, error) {
	if in.ConversationID == uuid.Nil || in.UserID == uuid.Nil {
		return nil, false, ErrInvalidInput
	}
	existing, err := uc.Repo.GetProjectByConversation(ctx, in.ConversationID, in.UserID)
	if err == nil {
		return existing, false, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return nil, false, err
	}

	kind := strings.TrimSpace(in.Kind)
	if kind == "" {
		kind = domain.DefaultKind
	}
	stack := strings.TrimSpace(in.Stack)
	if stack == "" {
		stack = domain.DefaultStack
	}
	now := time.Now().UTC()
	p := &domain.Project{
		ID:               uuid.New(),
		UserID:           in.UserID,
		ConversationID:   in.ConversationID,
		Title:            strings.TrimSpace(in.Title),
		Kind:             kind,
		Stack:            stack,
		LatestVersionSeq: 0,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if err := uc.Repo.CreateProject(ctx, p); err != nil {
		return nil, false, err
	}
	return p, true, nil
}
