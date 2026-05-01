CREATE TABLE IF NOT EXISTS laele_schedule_queue (
  id VARCHAR(36) NOT NULL,
  kind VARCHAR(16) NOT NULL, -- 'task' | 'workflow'
  entity_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  scheduled_for DATETIME(3) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'queued', -- queued | running | done | error
  attempts INT NOT NULL DEFAULT 0,
  locked_until DATETIME(3) NULL DEFAULT NULL,
  last_error TEXT NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE(kind, entity_id, scheduled_for)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_schedule_queue_status_due
  ON laele_schedule_queue (status, scheduled_for);

CREATE INDEX idx_schedule_queue_locked_until
  ON laele_schedule_queue (locked_until);
