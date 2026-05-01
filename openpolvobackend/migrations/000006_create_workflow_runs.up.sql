CREATE TABLE IF NOT EXISTS laele_workflow_runs (
    id VARCHAR(36) NOT NULL,
    workflow_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    status VARCHAR(32) NOT NULL,
    step_log TEXT NULL,
    error_message TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    finished_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (workflow_id) REFERENCES laele_workflows (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES laele_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_laele_workflow_runs_workflow ON laele_workflow_runs (workflow_id, created_at);
CREATE INDEX idx_laele_workflow_runs_user ON laele_workflow_runs (user_id, created_at);
