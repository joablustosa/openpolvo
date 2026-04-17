CREATE TABLE IF NOT EXISTS laele_task_lists (
    id          CHAR(36)     NOT NULL,
    user_id     CHAR(36)     NOT NULL,
    title       VARCHAR(512) NOT NULL DEFAULT '',
    status      VARCHAR(32)  NOT NULL DEFAULT 'pending',
    created_at  DATETIME(3)  NOT NULL,
    updated_at  DATETIME(3)  NOT NULL,
    finished_at DATETIME(3)  NULL,
    PRIMARY KEY (id),
    KEY idx_task_lists_user (user_id, created_at),
    CONSTRAINT fk_task_lists_user
        FOREIGN KEY (user_id) REFERENCES laele_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
