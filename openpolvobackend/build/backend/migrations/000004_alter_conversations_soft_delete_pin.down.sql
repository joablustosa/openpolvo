ALTER TABLE laele_conversations
  DROP INDEX  idx_laele_conversations_user_active,
  DROP COLUMN pinned_at,
  DROP COLUMN deleted_at;
