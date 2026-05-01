CREATE TABLE IF NOT EXISTS laele_task_lists (
    id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    finished_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES laele_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_task_lists_user ON laele_task_lists (user_id, created_at);
