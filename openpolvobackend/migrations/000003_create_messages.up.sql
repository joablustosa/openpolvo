CREATE TABLE IF NOT EXISTS laele_messages (
    id CHAR(36) NOT NULL,
    conversation_id CHAR(36) NOT NULL,
    role VARCHAR(32) NOT NULL,
    content LONGTEXT NOT NULL,
    metadata JSON NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    KEY idx_laele_messages_conversation_created (conversation_id, created_at),
    CONSTRAINT fk_laele_messages_conversation FOREIGN KEY (conversation_id) REFERENCES laele_conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
