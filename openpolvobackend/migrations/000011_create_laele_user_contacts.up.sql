CREATE TABLE IF NOT EXISTS laele_user_contacts (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES laele_users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_laele_user_contacts_user ON laele_user_contacts (user_id);
