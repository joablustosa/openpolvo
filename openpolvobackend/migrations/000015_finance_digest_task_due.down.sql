ALTER TABLE laele_task_items DROP INDEX idx_task_items_user_due;
ALTER TABLE laele_task_items DROP COLUMN due_at;

DROP TABLE IF EXISTS laele_user_digest_settings;
DROP TABLE IF EXISTS laele_finance_subscriptions;
DROP TABLE IF EXISTS laele_finance_transactions;
DROP TABLE IF EXISTS laele_finance_categories;
