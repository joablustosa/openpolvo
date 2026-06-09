package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/projects/application"
	"github.com/open-polvo/open-polvo/internal/projects/domain"
	"github.com/open-polvo/open-polvo/internal/projects/ports"
)

// ProjectRepository implementa ports.ProjectRepository sobre SQL (sqlite/mysql).
type ProjectRepository struct {
	DB *sql.DB
}

var _ ports.ProjectRepository = ProjectRepository{}

func (r ProjectRepository) CreateProject(ctx context.Context, p *domain.Project) error {
	_, err := r.DB.ExecContext(ctx, `
		INSERT INTO laele_dev_projects
		  (id, user_id, conversation_id, title, kind, stack, latest_version_seq, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.ID.String(), p.UserID.String(), p.ConversationID.String(), p.Title, p.Kind, p.Stack,
		p.LatestVersionSeq, p.CreatedAt.UTC(), p.UpdatedAt.UTC(),
	)
	if err != nil {
		return fmt.Errorf("create project: %w", err)
	}
	return nil
}

func (r ProjectRepository) GetProjectByConversation(ctx context.Context, conversationID, userID uuid.UUID) (*domain.Project, error) {
	row := r.DB.QueryRowContext(ctx, `
		SELECT id, user_id, conversation_id, title, kind, stack, latest_version_seq, created_at, updated_at
		FROM laele_dev_projects WHERE conversation_id = ? AND user_id = ? LIMIT 1`,
		conversationID.String(), userID.String(),
	)
	return scanProject(row)
}

func (r ProjectRepository) GetProjectByID(ctx context.Context, id, userID uuid.UUID) (*domain.Project, error) {
	row := r.DB.QueryRowContext(ctx, `
		SELECT id, user_id, conversation_id, title, kind, stack, latest_version_seq, created_at, updated_at
		FROM laele_dev_projects WHERE id = ? AND user_id = ? LIMIT 1`,
		id.String(), userID.String(),
	)
	return scanProject(row)
}

func (r ProjectRepository) ListProjectsByUser(ctx context.Context, userID uuid.UUID) ([]domain.Project, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT id, user_id, conversation_id, title, kind, stack, latest_version_seq, created_at, updated_at
		FROM laele_dev_projects WHERE user_id = ? ORDER BY updated_at DESC`,
		userID.String(),
	)
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	defer rows.Close()
	var out []domain.Project
	for rows.Next() {
		p, err := scanProjectRows(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list projects rows: %w", err)
	}
	return out, nil
}

func (r ProjectRepository) SaveVersion(ctx context.Context, v *domain.ProjectVersion, files []domain.ProjectFile) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("save version begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO laele_dev_project_versions (id, project_id, seq, summary, created_at)
		VALUES (?, ?, ?, ?, ?)`,
		v.ID.String(), v.ProjectID.String(), v.Seq, v.Summary, v.CreatedAt.UTC(),
	); err != nil {
		return fmt.Errorf("save version insert: %w", err)
	}

	for i := range files {
		f := &files[i]
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO laele_dev_project_files (version_id, path, content)
			VALUES (?, ?, ?)`,
			f.VersionID.String(), f.Path, f.Content,
		); err != nil {
			return fmt.Errorf("save version file %q: %w", f.Path, err)
		}
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE laele_dev_projects SET latest_version_seq = ?, updated_at = ? WHERE id = ?`,
		v.Seq, v.CreatedAt.UTC(), v.ProjectID.String(),
	); err != nil {
		return fmt.Errorf("save version update project: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("save version commit: %w", err)
	}
	return nil
}

func (r ProjectRepository) ListVersions(ctx context.Context, projectID uuid.UUID) ([]domain.ProjectVersion, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT id, project_id, seq, summary, created_at
		FROM laele_dev_project_versions WHERE project_id = ? ORDER BY seq ASC`,
		projectID.String(),
	)
	if err != nil {
		return nil, fmt.Errorf("list versions: %w", err)
	}
	defer rows.Close()
	var out []domain.ProjectVersion
	for rows.Next() {
		v, err := scanVersionRows(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list versions rows: %w", err)
	}
	return out, nil
}

func (r ProjectRepository) GetVersionBySeq(ctx context.Context, projectID uuid.UUID, seq int) (*domain.ProjectVersion, error) {
	row := r.DB.QueryRowContext(ctx, `
		SELECT id, project_id, seq, summary, created_at
		FROM laele_dev_project_versions WHERE project_id = ? AND seq = ? LIMIT 1`,
		projectID.String(), seq,
	)
	return scanVersion(row)
}

func (r ProjectRepository) GetLatestVersion(ctx context.Context, projectID uuid.UUID) (*domain.ProjectVersion, error) {
	row := r.DB.QueryRowContext(ctx, `
		SELECT id, project_id, seq, summary, created_at
		FROM laele_dev_project_versions WHERE project_id = ? ORDER BY seq DESC LIMIT 1`,
		projectID.String(),
	)
	return scanVersion(row)
}

func (r ProjectRepository) GetFilesByVersion(ctx context.Context, versionID uuid.UUID) ([]domain.ProjectFile, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT version_id, path, content
		FROM laele_dev_project_files WHERE version_id = ? ORDER BY path ASC`,
		versionID.String(),
	)
	if err != nil {
		return nil, fmt.Errorf("get files: %w", err)
	}
	defer rows.Close()
	var out []domain.ProjectFile
	for rows.Next() {
		var versionIDStr, path, content string
		if err := rows.Scan(&versionIDStr, &path, &content); err != nil {
			return nil, fmt.Errorf("scan file: %w", err)
		}
		vid, err := uuid.Parse(versionIDStr)
		if err != nil {
			return nil, fmt.Errorf("parse version id: %w", err)
		}
		out = append(out, domain.ProjectFile{VersionID: vid, Path: path, Content: content})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("get files rows: %w", err)
	}
	return out, nil
}

// ─── helpers ─────────────────────────────────────────────────────────────────

type scannable interface {
	Scan(dest ...any) error
}

func scanProject(row *sql.Row) (*domain.Project, error) {
	p, err := scanProjectRows(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, application.ErrNotFound
	}
	return p, err
}

func scanProjectRows(row scannable) (*domain.Project, error) {
	var (
		idStr, uidStr, convStr, title, kind, stack string
		latestSeq                                  int
		created, updated                           time.Time
	)
	if err := row.Scan(&idStr, &uidStr, &convStr, &title, &kind, &stack, &latestSeq, &created, &updated); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, application.ErrNotFound
		}
		return nil, fmt.Errorf("scan project: %w", err)
	}
	id, err := uuid.Parse(idStr)
	if err != nil {
		return nil, fmt.Errorf("parse project id: %w", err)
	}
	uid, err := uuid.Parse(uidStr)
	if err != nil {
		return nil, fmt.Errorf("parse user id: %w", err)
	}
	conv, err := uuid.Parse(convStr)
	if err != nil {
		return nil, fmt.Errorf("parse conversation id: %w", err)
	}
	return &domain.Project{
		ID:               id,
		UserID:           uid,
		ConversationID:   conv,
		Title:            title,
		Kind:             kind,
		Stack:            stack,
		LatestVersionSeq: latestSeq,
		CreatedAt:        created.UTC(),
		UpdatedAt:        updated.UTC(),
	}, nil
}

func scanVersion(row *sql.Row) (*domain.ProjectVersion, error) {
	v, err := scanVersionRows(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, application.ErrNotFound
	}
	return v, err
}

func scanVersionRows(row scannable) (*domain.ProjectVersion, error) {
	var (
		idStr, projStr, summary string
		seq                     int
		created                 time.Time
	)
	if err := row.Scan(&idStr, &projStr, &seq, &summary, &created); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, application.ErrNotFound
		}
		return nil, fmt.Errorf("scan version: %w", err)
	}
	id, err := uuid.Parse(idStr)
	if err != nil {
		return nil, fmt.Errorf("parse version id: %w", err)
	}
	proj, err := uuid.Parse(projStr)
	if err != nil {
		return nil, fmt.Errorf("parse project id: %w", err)
	}
	return &domain.ProjectVersion{
		ID:        id,
		ProjectID: proj,
		Seq:       seq,
		Summary:   summary,
		CreatedAt: created.UTC(),
	}, nil
}
