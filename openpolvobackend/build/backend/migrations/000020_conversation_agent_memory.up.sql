CREATE TABLE IF NOT EXISTS laele_conversation_agent_memory (
    conversation_id VARCHAR(36) NOT NULL,
    global_content TEXT NOT NULL DEFAULT '',
    builder_content TEXT NOT NULL DEFAULT '',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (conversation_id),
    FOREIGN KEY (conversation_id) REFERENCES laele_conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
