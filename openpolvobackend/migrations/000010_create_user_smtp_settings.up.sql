CREATE TABLE IF NOT EXISTS laele_user_smtp_settings (
    user_id CHAR(36) NOT NULL,
    host VARCHAR(255) NOT NULL,
    port INT NOT NULL DEFAULT 587,
    username VARCHAR(512) NOT NULL DEFAULT '',
    password_enc VARBINARY(4096) NOT NULL,
    from_email VARCHAR(320) NOT NULL,
    from_name VARCHAR(200) NOT NULL DEFAULT '',
    use_tls TINYINT(1) NOT NULL DEFAULT 1,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (user_id),
    CONSTRAINT fk_laele_user_smtp_user FOREIGN KEY (user_id) REFERENCES laele_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
