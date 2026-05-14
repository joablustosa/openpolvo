ALTER TABLE laele_conversations ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL;
ALTER TABLE laele_conversations ADD COLUMN pinned_at DATETIME NULL DEFAULT NULL;
CREATE INDEX idx_laele_conversations_user_active ON laele_conversations (user_id, deleted_at, pinned_at, updated_at);
