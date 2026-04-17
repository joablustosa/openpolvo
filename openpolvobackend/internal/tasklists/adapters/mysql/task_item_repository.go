package mysql

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
	"github.com/open-polvo/open-polvo/internal/tasklists/domain"
	"github.com/open-polvo/open-polvo/internal/tasklists/ports"
)

const tiCols = `id, task_list_id, user_id, position, title, description, status, result, error_msg, started_at, finished_at`

// TaskItemRepository implementa ports.TaskItemRepository em MySQL.
type TaskItemRepository struct {
	DB *sql.DB
}

var _ ports.TaskItemRepository = (*TaskItemRepository)(nil)

func NewTaskItemRepository(db *sql.DB) *TaskItemRepository {
	return &TaskItemRepository{DB: db}
}

func (r *TaskItemRepository) CreateBatch(ctx context.Context, items []domain.TaskItem) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	stmt, err := tx.PrepareContext(ctx,
		`INSERT INTO laele_task_items (id, task_list_id, user_id, position, title, description, status, result, error_msg, started_at, finished_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, item := range items {
		_, err := stmt.ExecContext(ctx,
			item.ID.String(), item.TaskListID.String(), item.UserID.String(),
			item.Position, item.Title, item.Description,
			string(item.Status), item.Result, item.ErrorMsg,
			item.StartedAt, item.FinishedAt,
		)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (r *TaskItemRepository) Update(ctx context.Context, item *domain.TaskItem) error {
	_, err := r.DB.ExecContext(ctx,
		`UPDATE laele_task_items SET status = ?, result = ?, error_msg = ?, started_at = ?, finished_at = ? WHERE id = ?`,
		string(item.Status), item.Result, item.ErrorMsg,
		item.StartedAt, item.FinishedAt,
		item.ID.String(),
	)
	return err
}

func (r *TaskItemRepository) ListByTaskList(ctx context.Context, taskListID uuid.UUID) ([]domain.TaskItem, error) {
	rows, err := r.DB.QueryContext(ctx,
		`SELECT `+tiCols+` FROM laele_task_items WHERE task_list_id = ? ORDER BY position ASC`,
		taskListID.String(),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.TaskItem
	for rows.Next() {
		item, err := scanTaskItemRows(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *item)
	}
	return out, rows.Err()
}
