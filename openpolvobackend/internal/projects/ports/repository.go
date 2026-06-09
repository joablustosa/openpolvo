package ports

import (
	"context"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/projects/domain"
)

// ProjectRepository persiste projetos de dev, as suas versões e ficheiros.
// As implementações vivem em adapters/ e usam SQL parametrizado.
type ProjectRepository interface {
	// CreateProject insere um novo projeto.
	CreateProject(ctx context.Context, p *domain.Project) error
	// GetProjectByConversation devolve o projeto da conversa (do utilizador) ou ErrNotFound.
	GetProjectByConversation(ctx context.Context, conversationID, userID uuid.UUID) (*domain.Project, error)
	// GetProjectByID devolve o projeto por id (do utilizador) ou ErrNotFound.
	GetProjectByID(ctx context.Context, id, userID uuid.UUID) (*domain.Project, error)
	// ListProjectsByUser devolve todos os projetos do utilizador.
	ListProjectsByUser(ctx context.Context, userID uuid.UUID) ([]domain.Project, error)
	// SaveVersion grava a versão e os seus ficheiros e actualiza latest_version_seq/updated_at do projeto numa transação.
	SaveVersion(ctx context.Context, v *domain.ProjectVersion, files []domain.ProjectFile) error
	// ListVersions lista as versões do projeto por ordem crescente de seq.
	ListVersions(ctx context.Context, projectID uuid.UUID) ([]domain.ProjectVersion, error)
	// GetVersionBySeq devolve a versão com o seq dado ou ErrNotFound.
	GetVersionBySeq(ctx context.Context, projectID uuid.UUID, seq int) (*domain.ProjectVersion, error)
	// GetLatestVersion devolve a versão mais recente do projeto ou ErrNotFound.
	GetLatestVersion(ctx context.Context, projectID uuid.UUID) (*domain.ProjectVersion, error)
	// GetFilesByVersion devolve os ficheiros de uma versão.
	GetFilesByVersion(ctx context.Context, versionID uuid.UUID) ([]domain.ProjectFile, error)
}
