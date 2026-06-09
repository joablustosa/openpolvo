package application

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/projects/domain"
	"github.com/open-polvo/open-polvo/internal/projects/ports"
)

// SaveVersionInput descreve uma nova versão a persistir.
type SaveVersionInput struct {
	Project *domain.Project
	Summary string
	Files   map[string]string
}

// SaveProjectVersion cria uma nova versão (seq = latest+1) com os ficheiros
// fornecidos e actualiza o projeto.
type SaveProjectVersion struct {
	Repo ports.ProjectRepository
}

func (uc *SaveProjectVersion) Execute(ctx context.Context, in SaveVersionInput) (*domain.Project, *domain.ProjectVersion, error) {
	if in.Project == nil {
		return nil, nil, ErrInvalidInput
	}
	now := time.Now().UTC()
	seq := in.Project.LatestVersionSeq + 1
	v := &domain.ProjectVersion{
		ID:        uuid.New(),
		ProjectID: in.Project.ID,
		Seq:       seq,
		Summary:   in.Summary,
		CreatedAt: now,
	}
	files := make([]domain.ProjectFile, 0, len(in.Files))
	for path, content := range in.Files {
		files = append(files, domain.ProjectFile{
			VersionID: v.ID,
			Path:      path,
			Content:   content,
		})
	}
	if err := uc.Repo.SaveVersion(ctx, v, files); err != nil {
		return nil, nil, err
	}
	in.Project.LatestVersionSeq = seq
	in.Project.UpdatedAt = now
	return in.Project, v, nil
}
