CREATE TABLE IF NOT EXISTS laele_messages (
    id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (conversation_id) REFERENCES laele_conversations (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_laele_messages_conversation_created ON laele_messages (conversation_id, created_at);
