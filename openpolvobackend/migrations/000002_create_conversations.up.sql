CREATE TABLE IF NOT EXISTS laele_conversations (
    id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    title VARCHAR(512) NULL,
    langgraph_thread_id VARCHAR(255) NOT NULL,
    default_model_provider VARCHAR(32) NOT NULL DEFAULT 'openai',
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    KEY idx_laele_conversations_user_updated (user_id, updated_at),
    CONSTRAINT fk_laele_conversations_user FOREIGN KEY (user_id) REFERENCES laele_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
