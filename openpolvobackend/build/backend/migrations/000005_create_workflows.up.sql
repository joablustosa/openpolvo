CREATE TABLE IF NOT EXISTS laele_workflows (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    graph_json TEXT NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES laele_users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_laele_workflows_user_updated ON laele_workflows (user_id, updated_at);
