CREATE TABLE IF NOT EXISTS laele_user_smtp_settings (
    user_id TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 587,
    username TEXT NOT NULL DEFAULT '',
    password_enc BLOB NOT NULL,
    from_email TEXT NOT NULL,
    from_name TEXT NOT NULL DEFAULT '',
    use_tls INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id),
    FOREIGN KEY (user_id) REFERENCES laele_users (id) ON DELETE CASCADE
);
