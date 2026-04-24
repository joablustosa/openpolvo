package sqlite

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
	"github.com/open-polvo/open-polvo/internal/tasklists/domain"
)

func scanTaskList(
	id, userID, title, status string,
	createdAt, updatedAt time.Time,
	finishedAt *time.Time,
) (*domain.TaskList, error) {
	lid, err := uuid.Parse(id)
	if err != nil {
		return nil, err
	}
	uid, err := uuid.Parse(userID)
	if err != nil {
		return nil, err
	}
	return &domain.TaskList{
		ID:         lid,
		UserID:     uid,
		Title:      title,
		Status:     domain.ListStatus(status),
		CreatedAt:  createdAt,
		UpdatedAt:  updatedAt,
		FinishedAt: finishedAt,
	}, nil
}

func scanTaskListRow(row *sql.Row) (*domain.TaskList, error) {
	var (
		id, userID, title, status string
		createdAt, updatedAt      time.Time
		finishedAt                *time.Time
	)
	if err := row.Scan(&id, &userID, &title, &status, &createdAt, &updatedAt, &finishedAt); err != nil {
		return nil, err
	}
	return scanTaskList(id, userID, title, status, createdAt, updatedAt, finishedAt)
}

func scanTaskListRows(rows *sql.Rows) (*domain.TaskList, error) {
	var (
		id, userID, title, status string
		createdAt, updatedAt      time.Time
		finishedAt                *time.Time
	)
	if err := rows.Scan(&id, &userID, &title, &status, &createdAt, &updatedAt, &finishedAt); err != nil {
		return nil, err
	}
	return scanTaskList(id, userID, title, status, createdAt, updatedAt, finishedAt)
}

func scanTaskItem(
	id, taskListID, userID string,
	position int,
	title string,
	description *string,
	status string,
	result, errorMsg *string,
	startedAt, finishedAt *time.Time,
	dueAt *time.Time,
) (*domain.TaskItem, error) {
	iid, err := uuid.Parse(id)
	if err != nil {
		return nil, err
	}
	lid, err := uuid.Parse(taskListID)
	if err != nil {
		return nil, err
	}
	uid, err := uuid.Parse(userID)
	if err != nil {
		return nil, err
	}
	return &domain.TaskItem{
		ID:          iid,
		TaskListID:  lid,
		UserID:      uid,
		Position:    position,
		Title:       title,
		Description: description,
		Status:      domain.ItemStatus(status),
		Result:      result,
		ErrorMsg:    errorMsg,
		StartedAt:   startedAt,
		FinishedAt:  finishedAt,
		DueAt:       dueAt,
	}, nil
}

func scanTaskItemRows(rows *sql.Rows) (*domain.TaskItem, error) {
	var (
		id, taskListID, userID string
		position               int
		title                  string
		description            *string
		status                 string
		result, errorMsg       *string
		startedAt, finishedAt  *time.Time
		dueAt                  *time.Time
	)
	if err := rows.Scan(
		&id, &taskListID, &userID,
		&position, &title, &description,
		&status, &result, &errorMsg,
		&startedAt, &finishedAt, &dueAt,
	); err != nil {
		return nil, err
	}
	return scanTaskItem(id, taskListID, userID, position, title, description, status, result, errorMsg, startedAt, finishedAt, dueAt)
}
