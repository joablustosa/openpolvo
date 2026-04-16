ALTER TABLE laele_conversations
  ADD COLUMN deleted_at DATETIME(3) NULL DEFAULT NULL,
  ADD COLUMN pinned_at  DATETIME(3) NULL DEFAULT NULL,
  ADD INDEX idx_laele_conversations_user_active (user_id, deleted_at, pinned_at, updated_at);
