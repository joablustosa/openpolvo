CREATE TABLE IF NOT EXISTS laele_workflow_runs (
    id CHAR(36) NOT NULL,
    workflow_id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    status VARCHAR(32) NOT NULL,
    step_log JSON NULL,
    error_message TEXT NULL,
    created_at DATETIME(3) NOT NULL,
    finished_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    KEY idx_laele_workflow_runs_workflow (workflow_id, created_at),
    KEY idx_laele_workflow_runs_user (user_id, created_at),
    CONSTRAINT fk_laele_workflow_runs_workflow FOREIGN KEY (workflow_id) REFERENCES laele_workflows (id) ON DELETE CASCADE,
    CONSTRAINT fk_laele_workflow_runs_user FOREIGN KEY (user_id) REFERENCES laele_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
