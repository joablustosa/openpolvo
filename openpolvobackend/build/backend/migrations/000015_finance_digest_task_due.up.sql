-- Finanças pessoais, digest diário, prazo em tarefas (SQLite)

CREATE TABLE IF NOT EXISTS laele_finance_categories (
    id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    parent_id VARCHAR(36) NULL,
    name TEXT NOT NULL DEFAULT '',
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES laele_users(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES laele_finance_categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_fin_cat_user ON laele_finance_categories (user_id, parent_id, sort_order);

CREATE TABLE IF NOT EXISTS laele_finance_transactions (
    id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    amount_minor INT NOT NULL,
    currency VARCHAR(8) NOT NULL DEFAULT 'EUR',
    direction VARCHAR(16) NOT NULL,
    category_id VARCHAR(36) NULL,
    subcategory_id VARCHAR(36) NULL,
    occurred_at DATETIME(3) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    source VARCHAR(32) NOT NULL DEFAULT 'manual',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES laele_users(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES laele_finance_categories(id) ON DELETE SET NULL,
    FOREIGN KEY (subcategory_id) REFERENCES laele_finance_categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_fin_tx_user_time ON laele_finance_transactions (user_id, occurred_at);
CREATE INDEX idx_fin_tx_user_dir ON laele_finance_transactions (user_id, direction, occurred_at);

CREATE TABLE IF NOT EXISTS laele_finance_subscriptions (
    id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    amount_minor INT NOT NULL DEFAULT 0,
    currency VARCHAR(8) NOT NULL DEFAULT 'EUR',
    cadence VARCHAR(32) NOT NULL DEFAULT 'monthly',
    anchor_day INT NULL,
    next_due_at DATETIME(3) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    last_paid_at DATETIME(3) NULL,
    reminder_active TINYINT(1) NOT NULL DEFAULT 0,
    last_reminder_sent_on DATE NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES laele_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_fin_sub_user_due ON laele_finance_subscriptions (user_id, next_due_at, status);

CREATE TABLE IF NOT EXISTS laele_user_digest_settings (
    user_id VARCHAR(36) NOT NULL,
    timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Lisbon',
    digest_hour INT NOT NULL DEFAULT 8,
    digest_enabled TINYINT(1) NOT NULL DEFAULT 0,
    include_finance_summary TINYINT(1) NOT NULL DEFAULT 1,
    include_tasks TINYINT(1) NOT NULL DEFAULT 1,
    last_digest_sent_on DATE NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (user_id),
    FOREIGN KEY (user_id) REFERENCES laele_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE laele_task_items ADD COLUMN due_at DATETIME(3) NULL;
CREATE INDEX idx_task_items_user_due ON laele_task_items (user_id, due_at);
