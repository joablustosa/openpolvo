CREATE TABLE IF NOT EXISTS laele_task_items (
    id TEXT NOT NULL,
    task_list_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT NULL,
    error_msg TEXT NULL,
    started_at TEXT NULL,
    finished_at TEXT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (task_list_id) REFERENCES laele_task_lists(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES laele_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task_items_list ON laele_task_items (task_list_id, position);
