-- Finanças pessoais, digest diário, prazo em tarefas

CREATE TABLE IF NOT EXISTS laele_finance_categories (
    id          CHAR(36)     NOT NULL,
    user_id     CHAR(36)     NOT NULL,
    parent_id   CHAR(36)     NULL,
    name        VARCHAR(255) NOT NULL DEFAULT '',
    sort_order  INT          NOT NULL DEFAULT 0,
    created_at  DATETIME(3)  NOT NULL,
    updated_at  DATETIME(3)  NOT NULL,
    PRIMARY KEY (id),
    KEY idx_fin_cat_user (user_id, parent_id, sort_order),
    CONSTRAINT fk_fin_cat_user
        FOREIGN KEY (user_id) REFERENCES laele_users(id) ON DELETE CASCADE,
    CONSTRAINT fk_fin_cat_parent
        FOREIGN KEY (parent_id) REFERENCES laele_finance_categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS laele_finance_transactions (
    id           CHAR(36)     NOT NULL,
    user_id      CHAR(36)     NOT NULL,
    amount_minor BIGINT       NOT NULL,
    currency     VARCHAR(8)   NOT NULL DEFAULT 'EUR',
    direction    VARCHAR(8)   NOT NULL,
    category_id  CHAR(36)     NULL,
    subcategory_id CHAR(36)   NULL,
    occurred_at  DATETIME(3)  NOT NULL,
    description  VARCHAR(1024) NOT NULL DEFAULT '',
    source       VARCHAR(16)  NOT NULL DEFAULT 'manual',
    created_at   DATETIME(3)  NOT NULL,
    PRIMARY KEY (id),
    KEY idx_fin_tx_user_time (user_id, occurred_at),
    KEY idx_fin_tx_user_dir (user_id, direction, occurred_at),
    CONSTRAINT fk_fin_tx_user
        FOREIGN KEY (user_id) REFERENCES laele_users(id) ON DELETE CASCADE,
    CONSTRAINT fk_fin_tx_cat
        FOREIGN KEY (category_id) REFERENCES laele_finance_categories(id) ON DELETE SET NULL,
    CONSTRAINT fk_fin_tx_subcat
        FOREIGN KEY (subcategory_id) REFERENCES laele_finance_categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS laele_finance_subscriptions (
    id                    CHAR(36)     NOT NULL,
    user_id               CHAR(36)     NOT NULL,
    name                  VARCHAR(512) NOT NULL DEFAULT '',
    amount_minor          BIGINT       NOT NULL DEFAULT 0,
    currency              VARCHAR(8)   NOT NULL DEFAULT 'EUR',
    cadence               VARCHAR(16)  NOT NULL DEFAULT 'monthly',
    anchor_day            TINYINT      NULL,
    next_due_at           DATETIME(3)  NOT NULL,
    status                VARCHAR(16)  NOT NULL DEFAULT 'active',
    last_paid_at          DATETIME(3)  NULL,
    reminder_active       TINYINT(1)   NOT NULL DEFAULT 0,
    last_reminder_sent_at DATE         NULL,
    created_at            DATETIME(3)  NOT NULL,
    updated_at            DATETIME(3)  NOT NULL,
    PRIMARY KEY (id),
    KEY idx_fin_sub_user_due (user_id, next_due_at, status),
    CONSTRAINT fk_fin_sub_user
        FOREIGN KEY (user_id) REFERENCES laele_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS laele_user_digest_settings (
    user_id                 CHAR(36)     NOT NULL,
    timezone                VARCHAR(64)  NOT NULL DEFAULT 'Europe/Lisbon',
    digest_hour             TINYINT UNSIGNED NOT NULL DEFAULT 8,
    digest_enabled          TINYINT(1)   NOT NULL DEFAULT 0,
    include_finance_summary TINYINT(1)   NOT NULL DEFAULT 1,
    include_tasks           TINYINT(1)   NOT NULL DEFAULT 1,
    last_digest_sent_on     DATE         NULL,
    updated_at              DATETIME(3)  NOT NULL,
    PRIMARY KEY (user_id),
    CONSTRAINT fk_digest_user
        FOREIGN KEY (user_id) REFERENCES laele_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE laele_task_items
    ADD COLUMN due_at DATETIME(3) NULL AFTER finished_at;

CREATE INDEX idx_task_items_user_due ON laele_task_items (user_id, due_at);
