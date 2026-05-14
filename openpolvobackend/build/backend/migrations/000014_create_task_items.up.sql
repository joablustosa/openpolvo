CREATE TABLE IF NOT EXISTS laele_task_items (
    id VARCHAR(36) NOT NULL,
    task_list_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    position INT NOT NULL DEFAULT 0,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    result TEXT NULL,
    error_msg TEXT NULL,
    started_at DATETIME(3) NULL,
    finished_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (task_list_id) REFERENCES laele_task_lists(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES laele_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_task_items_list ON laele_task_items (task_list_id, position);
