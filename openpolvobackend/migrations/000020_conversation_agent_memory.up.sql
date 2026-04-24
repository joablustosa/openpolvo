CREATE TABLE IF NOT EXISTS laele_conversation_agent_memory (
    conversation_id TEXT NOT NULL,
    global_content TEXT NOT NULL DEFAULT '',
    builder_content TEXT NOT NULL DEFAULT '',
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (conversation_id),
    FOREIGN KEY (conversation_id) REFERENCES laele_conversations (id) ON DELETE CASCADE
);
