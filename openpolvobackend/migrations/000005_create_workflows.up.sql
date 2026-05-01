CREATE TABLE IF NOT EXISTS laele_workflows (
    id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    graph_json JSON NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES laele_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_laele_workflows_user_updated ON laele_workflows (user_id, updated_at);
