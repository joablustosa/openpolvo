package sqlite

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
	"github.com/open-polvo/open-polvo/internal/tasklists/domain"
	"github.com/open-polvo/open-polvo/internal/tasklists/ports"
)

const tlCols = `id, user_id, title, status, created_at, updated_at, finished_at`

// TaskListRepository implementa ports.TaskListRepository em SQLite.
type TaskListRepository struct {
	DB *sql.DB
}

var _ ports.TaskListRepository = (*TaskListRepository)(nil)

func NewTaskListRepository(db *sql.DB) *TaskListRepository {
	return &TaskListRepository{DB: db}
}

func (r *TaskListRepository) Create(ctx context.Context, tl *domain.TaskList) error {
	_, err := r.DB.ExecContext(ctx,
		`INSERT INTO laele_task_lists (id, user_id, title, status, created_at, updated_at, finished_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		tl.ID.String(), tl.UserID.String(), tl.Title, string(tl.Status),
		tl.CreatedAt, tl.UpdatedAt, tl.FinishedAt,
	)
	return err
}

func (r *TaskListRepository) Update(ctx context.Context, tl *domain.TaskList) error {
	res, err := r.DB.ExecContext(ctx,
		`UPDATE laele_task_lists SET title = ?, status = ?, updated_at = ?, finished_at = ? WHERE id = ? AND user_id = ?`,
		tl.Title, string(tl.Status), tl.UpdatedAt, tl.FinishedAt,
		tl.ID.String(), tl.UserID.String(),
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (r *TaskListRepository) GetByIDAndUser(ctx context.Context, id, userID uuid.UUID) (*domain.TaskList, error) {
	row := r.DB.QueryRowContext(ctx,
		`SELECT `+tlCols+` FROM laele_task_lists WHERE id = ? AND user_id = ?`,
		id.String(), userID.String(),
	)
	return scanTaskListRow(row)
}

func (r *TaskListRepository) ListByUser(ctx context.Context, userID uuid.UUID, limit int) ([]domain.TaskList, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := r.DB.QueryContext(ctx,
		`SELECT `+tlCols+` FROM laele_task_lists WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
		userID.String(), limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.TaskList
	for rows.Next() {
		tl, err := scanTaskListRows(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *tl)
	}
	return out, rows.Err()
}

func (r *TaskListRepository) Delete(ctx context.Context, id, userID uuid.UUID) error {
	res, err := r.DB.ExecContext(ctx,
		`DELETE FROM laele_task_lists WHERE id = ? AND user_id = ?`,
		id.String(), userID.String(),
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}
