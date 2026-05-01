CREATE TABLE IF NOT EXISTS laele_user_contacts (
    id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    email VARCHAR(320) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES laele_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_laele_user_contacts_user ON laele_user_contacts (user_id);
