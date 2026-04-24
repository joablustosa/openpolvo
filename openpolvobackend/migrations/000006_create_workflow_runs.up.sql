CREATE TABLE IF NOT EXISTS laele_workflow_runs (
    id TEXT NOT NULL,
    workflow_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL,
    step_log TEXT NULL,
    error_message TEXT NULL,
    created_at DATETIME NOT NULL,
    finished_at DATETIME NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (workflow_id) REFERENCES laele_workflows (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES laele_users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_laele_workflow_runs_workflow ON laele_workflow_runs (workflow_id, created_at);
CREATE INDEX IF NOT EXISTS idx_laele_workflow_runs_user ON laele_workflow_runs (user_id, created_at);
