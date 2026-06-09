CREATE TABLE IF NOT EXISTS laele_dev_projects (
    id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    conversation_id VARCHAR(36) NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    kind VARCHAR(32) NOT NULL DEFAULT 'app',
    stack VARCHAR(64) NOT NULL DEFAULT 'vite-react',
    latest_version_seq INT NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE (conversation_id),
    FOREIGN KEY (conversation_id) REFERENCES laele_conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_dev_projects_user ON laele_dev_projects (user_id);

CREATE TABLE IF NOT EXISTS laele_dev_project_versions (
    id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    seq INT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE (project_id, seq),
    FOREIGN KEY (project_id) REFERENCES laele_dev_projects (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_dev_project_versions_project ON laele_dev_project_versions (project_id);

CREATE TABLE IF NOT EXISTS laele_dev_project_files (
    version_id VARCHAR(36) NOT NULL,
    path VARCHAR(512) NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (version_id, path),
    FOREIGN KEY (version_id) REFERENCES laele_dev_project_versions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
