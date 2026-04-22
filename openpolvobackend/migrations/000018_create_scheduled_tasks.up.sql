CREATE TABLE IF NOT EXISTS laele_scheduled_tasks (
  id            VARCHAR(36)  NOT NULL,
  user_id       VARCHAR(36)  NOT NULL,
  name          VARCHAR(255) NOT NULL,
  description   TEXT         NULL,
  task_type     VARCHAR(50)  NOT NULL,
  payload_json  TEXT         NOT NULL,
  cron_expr     VARCHAR(128) NOT NULL,
  timezone      VARCHAR(64)  NOT NULL,
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  last_run_at   DATETIME(3)  NULL,
  last_result   TEXT         NULL,
  last_error    TEXT         NULL,
  run_count     INT          NOT NULL DEFAULT 0,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_laele_sched_user_active (user_id, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
