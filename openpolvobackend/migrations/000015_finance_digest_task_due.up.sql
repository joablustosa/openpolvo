-- Finanças pessoais, digest diário, prazo em tarefas (SQLite)

CREATE TABLE IF NOT EXISTS laele_finance_categories (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    parent_id TEXT NULL,
    name TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES laele_users(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES laele_finance_categories(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_fin_cat_user ON laele_finance_categories (user_id, parent_id, sort_order);

CREATE TABLE IF NOT EXISTS laele_finance_transactions (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'EUR',
    direction TEXT NOT NULL,
    category_id TEXT NULL,
    subcategory_id TEXT NULL,
    occurred_at TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES laele_users(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES laele_finance_categories(id) ON DELETE SET NULL,
    FOREIGN KEY (subcategory_id) REFERENCES laele_finance_categories(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_fin_tx_user_time ON laele_finance_transactions (user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_fin_tx_user_dir ON laele_finance_transactions (user_id, direction, occurred_at);

CREATE TABLE IF NOT EXISTS laele_finance_subscriptions (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    amount_minor INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'EUR',
    cadence TEXT NOT NULL DEFAULT 'monthly',
    anchor_day INTEGER NULL,
    next_due_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    last_paid_at TEXT NULL,
    reminder_active INTEGER NOT NULL DEFAULT 0,
    last_reminder_sent_on TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES laele_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_fin_sub_user_due ON laele_finance_subscriptions (user_id, next_due_at, status);

CREATE TABLE IF NOT EXISTS laele_user_digest_settings (
    user_id TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Europe/Lisbon',
    digest_hour INTEGER NOT NULL DEFAULT 8,
    digest_enabled INTEGER NOT NULL DEFAULT 0,
    include_finance_summary INTEGER NOT NULL DEFAULT 1,
    include_tasks INTEGER NOT NULL DEFAULT 1,
    last_digest_sent_on TEXT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id),
    FOREIGN KEY (user_id) REFERENCES laele_users(id) ON DELETE CASCADE
);

ALTER TABLE laele_task_items ADD COLUMN due_at TEXT NULL;
CREATE INDEX IF NOT EXISTS idx_task_items_user_due ON laele_task_items (user_id, due_at);
