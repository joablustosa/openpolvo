CREATE TABLE IF NOT EXISTS laele_scheduled_tasks (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  name TEXT NOT NULL,
  description TEXT NULL,
  task_type VARCHAR(64) NOT NULL,
  payload_json JSON NOT NULL,
  cron_expr VARCHAR(255) NOT NULL,
  timezone VARCHAR(64) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  last_run_at DATETIME(3) NULL,
  last_result TEXT NULL,
  last_error TEXT NULL,
  run_count INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (user_id) REFERENCES laele_users(id) ON DELETE CASCADE
);
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_laele_sched_user_active ON laele_scheduled_tasks (user_id, active);
