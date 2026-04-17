CREATE TABLE IF NOT EXISTS laele_task_items (
    id           CHAR(36)      NOT NULL,
    task_list_id CHAR(36)      NOT NULL,
    user_id      CHAR(36)      NOT NULL,
    position     INT           NOT NULL DEFAULT 0,
    title        VARCHAR(1024) NOT NULL DEFAULT '',
    description  TEXT          NULL,
    status       VARCHAR(32)   NOT NULL DEFAULT 'pending',
    result       MEDIUMTEXT    NULL,
    error_msg    TEXT          NULL,
    started_at   DATETIME(3)   NULL,
    finished_at  DATETIME(3)   NULL,
    PRIMARY KEY (id),
    KEY idx_task_items_list (task_list_id, position),
    CONSTRAINT fk_task_items_list
        FOREIGN KEY (task_list_id) REFERENCES laele_task_lists(id) ON DELETE CASCADE,
    CONSTRAINT fk_task_items_user
        FOREIGN KEY (user_id) REFERENCES laele_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
