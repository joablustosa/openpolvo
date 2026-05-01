CREATE TABLE IF NOT EXISTS laele_conversations (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT NULL,
    langgraph_thread_id TEXT NOT NULL,
    default_model_provider TEXT NOT NULL DEFAULT 'openai',
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES laele_users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_laele_conversations_user_updated ON laele_conversations (user_id, updated_at);
