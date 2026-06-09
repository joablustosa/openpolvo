package application

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/projects/domain"
	"github.com/open-polvo/open-polvo/internal/projects/ports"
)

// RollbackToVersion cria uma nova versão com o conteúdo de uma versão anterior
// (preservando o histórico em vez de o apagar). Devolve o projeto e os ficheiros resultantes.
type RollbackToVersion struct {
	Repo ports.ProjectRepository
}

func (uc *RollbackToVersion) Execute(ctx context.Context, projectID, userID uuid.UUID, seq int) (*domain.Project, []domain.ProjectFile, error) {
	p, err := uc.Repo.GetProjectByID(ctx, projectID, userID)
	if err != nil {
		return nil, nil, err
	}
	target, err := uc.Repo.GetVersionBySeq(ctx, p.ID, seq)
	if err != nil {
		return nil, nil, err
	}
	targetFiles, err := uc.Repo.GetFilesByVersion(ctx, target.ID)
	if err != nil {
		return nil, nil, err
	}

	now := time.Now().UTC()
	newSeq := p.LatestVersionSeq + 1
	nv := &domain.ProjectVersion{
		ID:        uuid.New(),
		ProjectID: p.ID,
		Seq:       newSeq,
		Summary:   fmt.Sprintf("rollback para versão %d", seq),
		CreatedAt: now,
	}
	files := make([]domain.ProjectFile, 0, len(targetFiles))
	for _, f := range targetFiles {
		files = append(files, domain.ProjectFile{
			VersionID: nv.ID,
			Path:      f.Path,
			Content:   f.Content,
		})
	}
	if err := uc.Repo.SaveVersion(ctx, nv, files); err != nil {
		return nil, nil, err
	}
	p.LatestVersionSeq = newSeq
	p.UpdatedAt = now
	return p, files, nil
}
