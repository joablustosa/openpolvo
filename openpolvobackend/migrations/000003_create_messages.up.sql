CREATE TABLE IF NOT EXISTS laele_messages (
    id VARCHAR(36) NOT NULL,
    conversation_id VARCHAR(36) NOT NULL,
    role VARCHAR(32) NOT NULL,
    content TEXT NOT NULL,
    metadata JSON NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    FOREIGN KEY (conversation_id) REFERENCES laele_conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_laele_messages_conversation_created ON laele_messages (conversation_id, created_at);
