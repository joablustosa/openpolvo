CREATE TABLE IF NOT EXISTS laele_conversations (
    id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    title TEXT NULL,
    langgraph_thread_id VARCHAR(128) NOT NULL,
    default_model_provider VARCHAR(32) NOT NULL DEFAULT 'openai',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES laele_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_laele_conversations_user_updated ON laele_conversations (user_id, updated_at);
