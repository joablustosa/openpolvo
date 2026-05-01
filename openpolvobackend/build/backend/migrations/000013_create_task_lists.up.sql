CREATE TABLE IF NOT EXISTS laele_task_lists (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finished_at TEXT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES laele_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task_lists_user ON laele_task_lists (user_id, created_at);
