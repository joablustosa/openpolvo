package mysql

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/conversations/domain"
)

type MessageRepository struct {
	DB *sql.DB
}

func (r MessageRepository) Create(ctx context.Context, m *domain.Message) error {
	var meta any
	switch {
	case len(m.Metadata) == 0:
		meta = nil
	case json.Valid(m.Metadata):
		meta = string(m.Metadata)
	default:
		meta = string(m.Metadata)
	}
	_, err := r.DB.ExecContext(ctx,
		`INSERT INTO laele_messages (id, conversation_id, role, content, metadata, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		m.ID.String(), m.ConversationID.String(), m.Role, m.Content, meta, m.CreatedAt,
	)
	return err
}

func (r MessageRepository) ListByConversation(ctx context.Context, conversationID uuid.UUID) ([]domain.Message, error) {
	rows, err := r.DB.QueryContext(ctx,
		`SELECT id, conversation_id, role, content, metadata, created_at
		 FROM laele_messages WHERE conversation_id = ? ORDER BY created_at ASC`,
		conversationID.String(),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Message
	for rows.Next() {
		var (
			idStr, cid, role, content string
			meta                      sql.NullString
			created                   time.Time
		)
		if err := rows.Scan(&idStr, &cid, &role, &content, &meta, &created); err != nil {
			return nil, err
		}
		id, err := uuid.Parse(idStr)
		if err != nil {
			return nil, err
		}
		cidUUID, err := uuid.Parse(cid)
		if err != nil {
			return nil, err
		}
		var metaBytes []byte
		if meta.Valid {
			metaBytes = []byte(meta.String)
		}
		out = append(out, domain.Message{
			ID:             id,
			ConversationID: cidUUID,
			Role:           role,
			Content:        content,
			Metadata:       metaBytes,
			CreatedAt:      created,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if out == nil {
		out = []domain.Message{}
	}
	return out, nil
}
