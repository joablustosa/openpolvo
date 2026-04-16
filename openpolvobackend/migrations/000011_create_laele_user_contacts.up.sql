CREATE TABLE IF NOT EXISTS laele_user_contacts (
    id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(64) NOT NULL DEFAULT '',
    email VARCHAR(320) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    KEY idx_laele_user_contacts_user (user_id),
    CONSTRAINT fk_laele_user_contacts_user FOREIGN KEY (user_id) REFERENCES laele_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
