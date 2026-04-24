package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/conversations/domain"
	"github.com/open-polvo/open-polvo/internal/conversations/ports"
)

type ConversationRepository struct {
	DB *sql.DB
}

func (r ConversationRepository) Create(ctx context.Context, c *domain.Conversation) error {
	var title any
	if c.Title != nil {
		title = *c.Title
	}
	_, err := r.DB.ExecContext(ctx,
		`INSERT INTO laele_conversations (id, user_id, title, langgraph_thread_id, default_model_provider, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		c.ID.String(), c.UserID.String(), title, c.LangGraphThreadID, string(c.DefaultModel), c.CreatedAt, c.UpdatedAt,
	)
	return err
}

func (r ConversationRepository) GetByIDAndUser(ctx context.Context, conversationID, userID uuid.UUID) (*domain.Conversation, error) {
	row := r.DB.QueryRowContext(ctx,
		`SELECT id, user_id, title, langgraph_thread_id, default_model_provider, pinned_at, deleted_at, created_at, updated_at
		 FROM laele_conversations WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`,
		conversationID.String(), userID.String(),
	)
	return scanConversation(row)
}

func (r ConversationRepository) ListByUser(ctx context.Context, userID uuid.UUID, limit int) ([]domain.Conversation, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := r.DB.QueryContext(ctx,
		`SELECT id, user_id, title, langgraph_thread_id, default_model_provider, pinned_at, deleted_at, created_at, updated_at
		 FROM laele_conversations
		 WHERE user_id = ? AND deleted_at IS NULL
		 ORDER BY (pinned_at IS NULL) ASC, pinned_at DESC, updated_at DESC
		 LIMIT ?`,
		userID.String(), limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Conversation
	for rows.Next() {
		c, err := scanConversationRows(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

func (r ConversationRepository) UpdateTitle(ctx context.Context, conversationID, userID uuid.UUID, title string) error {
	res, err := r.DB.ExecContext(ctx,
		`UPDATE laele_conversations SET title = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
		title, time.Now().UTC(), conversationID.String(), userID.String(),
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ports.ErrNotFound
	}
	return nil
}

func (r ConversationRepository) TouchUpdatedAt(ctx context.Context, conversationID uuid.UUID, t time.Time) error {
	_, err := r.DB.ExecContext(ctx,
		`UPDATE laele_conversations SET updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
		t, conversationID.String(),
	)
	return err
}

func (r ConversationRepository) SoftDelete(ctx context.Context, conversationID, userID uuid.UUID) error {
	res, err := r.DB.ExecContext(ctx,
		`UPDATE laele_conversations SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
		time.Now().UTC(), conversationID.String(), userID.String(),
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ports.ErrNotFound
	}
	return nil
}

func (r ConversationRepository) SetPinnedAt(ctx context.Context, conversationID, userID uuid.UUID, pinnedAt *time.Time) error {
	res, err := r.DB.ExecContext(ctx,
		`UPDATE laele_conversations SET pinned_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
		pinnedAt, conversationID.String(), userID.String(),
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ports.ErrNotFound
	}
	return nil
}

func scanConversation(row *sql.Row) (*domain.Conversation, error) {
	var (
		idStr, uidStr, threadID, model string
		title                          sql.NullString
		pinnedAt, deletedAt            sql.NullTime
		created, updated               time.Time
	)
	if err := row.Scan(&idStr, &uidStr, &title, &threadID, &model, &pinnedAt, &deletedAt, &created, &updated); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ports.ErrNotFound
		}
		return nil, err
	}
	return buildConversation(idStr, uidStr, title, threadID, model, pinnedAt, deletedAt, created, updated)
}

type scanner interface {
	Scan(dest ...any) error
}

func scanConversationRows(rows scanner) (*domain.Conversation, error) {
	var (
		idStr, uidStr, threadID, model string
		title                          sql.NullString
		pinnedAt, deletedAt            sql.NullTime
		created, updated               time.Time
	)
	if err := rows.Scan(&idStr, &uidStr, &title, &threadID, &model, &pinnedAt, &deletedAt, &created, &updated); err != nil {
		return nil, err
	}
	return buildConversation(idStr, uidStr, title, threadID, model, pinnedAt, deletedAt, created, updated)
}

func buildConversation(idStr, uidStr string, title sql.NullString, threadID, model string, pinnedAt, deletedAt sql.NullTime, created, updated time.Time) (*domain.Conversation, error) {
	id, err := uuid.Parse(idStr)
	if err != nil {
		return nil, err
	}
	uid, err := uuid.Parse(uidStr)
	if err != nil {
		return nil, err
	}
	mp, ok := domain.ParseModelProvider(model)
	if !ok {
		mp = domain.ModelOpenAI
	}
	var tptr *string
	if title.Valid {
		tptr = &title.String
	}
	var pinnedPtr *time.Time
	if pinnedAt.Valid {
		t := pinnedAt.Time
		pinnedPtr = &t
	}
	var deletedPtr *time.Time
	if deletedAt.Valid {
		t := deletedAt.Time
		deletedPtr = &t
	}
	return &domain.Conversation{
		ID:                id,
		UserID:            uid,
		Title:             tptr,
		LangGraphThreadID: threadID,
		DefaultModel:      mp,
		PinnedAt:          pinnedPtr,
		DeletedAt:         deletedPtr,
		CreatedAt:         created,
		UpdatedAt:         updated,
	}, nil
}
