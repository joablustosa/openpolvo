package sqlite

import (
	"context"
	"database/sql"
	"time"

	"github.com/google/uuid"
	"github.com/open-polvo/open-polvo/internal/tasklists/domain"
	"github.com/open-polvo/open-polvo/internal/tasklists/ports"
)

const tiCols = `id, task_list_id, user_id, position, title, description, status, result, error_msg, started_at, finished_at, due_at`

// TaskItemRepository implementa ports.TaskItemRepository em SQLite.
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
		`INSERT INTO laele_task_items (id, task_list_id, user_id, position, title, description, status, result, error_msg, started_at, finished_at, due_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
			item.StartedAt, item.FinishedAt, item.DueAt,
		)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (r *TaskItemRepository) Update(ctx context.Context, item *domain.TaskItem) error {
	_, err := r.DB.ExecContext(ctx,
		`UPDATE laele_task_items SET status = ?, result = ?, error_msg = ?, started_at = ?, finished_at = ?, due_at = ? WHERE id = ?`,
		string(item.Status), item.Result, item.ErrorMsg,
		item.StartedAt, item.FinishedAt, item.DueAt,
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

func (r *TaskItemRepository) GetByIDAndUser(ctx context.Context, id, userID uuid.UUID) (*domain.TaskItem, error) {
	row := r.DB.QueryRowContext(ctx,
		`SELECT `+tiCols+` FROM laele_task_items WHERE id = ? AND user_id = ?`,
		id.String(), userID.String(),
	)
	var (
		tid, taskListID, uid string
		position             int
		title                string
		description          *string
		status               string
		result, errorMsg     *string
		startedAt, finishedAt *time.Time
		dueAt                *time.Time
	)
	if err := row.Scan(
		&tid, &taskListID, &uid,
		&position, &title, &description,
		&status, &result, &errorMsg,
		&startedAt, &finishedAt, &dueAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return nil, sql.ErrNoRows
		}
		return nil, err
	}
	return scanTaskItem(tid, taskListID, uid, position, title, description, status, result, errorMsg, startedAt, finishedAt, dueAt)
}

func (r *TaskItemRepository) DeleteByIDAndUser(ctx context.Context, id, userID uuid.UUID) error {
	res, err := r.DB.ExecContext(ctx,
		`DELETE FROM laele_task_items WHERE id = ? AND user_id = ? AND status = ?`,
		id.String(), userID.String(), string(domain.ItemPending),
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

func (r *TaskItemRepository) UpdateUserFields(ctx context.Context, id, userID uuid.UUID, title string, description *string, position int, dueAt *time.Time) error {
	res, err := r.DB.ExecContext(ctx,
		`UPDATE laele_task_items SET title = ?, description = ?, position = ?, due_at = ? WHERE id = ? AND user_id = ? AND status = ?`,
		title, description, position, dueAt,
		id.String(), userID.String(), string(domain.ItemPending),
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

func (r *TaskItemRepository) MaxPosition(ctx context.Context, taskListID uuid.UUID) (int, error) {
	row := r.DB.QueryRowContext(ctx,
		`SELECT COALESCE(MAX(position), -1) FROM laele_task_items WHERE task_list_id = ?`,
		taskListID.String(),
	)
	var max sql.NullInt64
	if err := row.Scan(&max); err != nil {
		return 0, err
	}
	if !max.Valid {
		return -1, nil
	}
	return int(max.Int64), nil
}

func (r *TaskItemRepository) ListDueInRangeForUser(ctx context.Context, userID uuid.UUID, from, to time.Time) ([]ports.TaskItemDueRow, error) {
	rows, err := r.DB.QueryContext(ctx,
		`SELECT ti.id, ti.task_list_id, tl.title, ti.title, ti.due_at
		 FROM laele_task_items ti
		 INNER JOIN laele_task_lists tl ON tl.id = ti.task_list_id AND tl.user_id = ti.user_id
		 WHERE ti.user_id = ? AND ti.due_at IS NOT NULL AND ti.due_at >= ? AND ti.due_at < ?
		 ORDER BY ti.due_at ASC`,
		userID.String(), from, to,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ports.TaskItemDueRow
	for rows.Next() {
		var iid, lid, listTitle, title string
		var due time.Time
		if err := rows.Scan(&iid, &lid, &listTitle, &title, &due); err != nil {
			return nil, err
		}
		itemUUID, err := uuid.Parse(iid)
		if err != nil {
			continue
		}
		listUUID, err := uuid.Parse(lid)
		if err != nil {
			continue
		}
		out = append(out, ports.TaskItemDueRow{
			ItemID: itemUUID, TaskListID: listUUID, ListTitle: listTitle, Title: title, DueAt: due,
		})
	}
	return out, rows.Err()
}
