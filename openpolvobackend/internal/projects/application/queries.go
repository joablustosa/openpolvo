package application

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/projects/domain"
	"github.com/open-polvo/open-polvo/internal/projects/ports"
)

// GetProjectForConversation devolve o projeto vinculado à conversa, ou ErrNotFound.
type GetProjectForConversation struct {
	Repo ports.ProjectRepository
}

func (uc *GetProjectForConversation) Execute(ctx context.Context, conversationID, userID uuid.UUID) (*domain.Project, error) {
	return uc.Repo.GetProjectByConversation(ctx, conversationID, userID)
}

// GetProjectWithLatestFiles devolve o projeto e os ficheiros da sua última versão.
type GetProjectWithLatestFiles struct {
	Repo ports.ProjectRepository
}

func (uc *GetProjectWithLatestFiles) Execute(ctx context.Context, id, userID uuid.UUID) (*domain.Project, []domain.ProjectFile, error) {
	p, err := uc.Repo.GetProjectByID(ctx, id, userID)
	if err != nil {
		return nil, nil, err
	}
	if p.LatestVersionSeq == 0 {
		return p, nil, nil
	}
	v, err := uc.Repo.GetLatestVersion(ctx, p.ID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return p, nil, nil
		}
		return nil, nil, err
	}
	files, err := uc.Repo.GetFilesByVersion(ctx, v.ID)
	if err != nil {
		return nil, nil, err
	}
	return p, files, nil
}

// ListVersions devolve as versões do projeto (após validar a posse).
type ListVersions struct {
	Repo ports.ProjectRepository
}

func (uc *ListVersions) Execute(ctx context.Context, id, userID uuid.UUID) ([]domain.ProjectVersion, error) {
	if _, err := uc.Repo.GetProjectByID(ctx, id, userID); err != nil {
		return nil, err
	}
	return uc.Repo.ListVersions(ctx, id)
}
