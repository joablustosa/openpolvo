CREATE TABLE IF NOT EXISTS laele_schedule_queue (
  id TEXT NOT NULL,
  kind TEXT NOT NULL, -- 'task' | 'workflow'
  entity_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  scheduled_for DATETIME NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | running | done | error
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until DATETIME NULL DEFAULT NULL,
  last_error TEXT NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE(kind, entity_id, scheduled_for)
);

CREATE INDEX IF NOT EXISTS idx_schedule_queue_status_due
  ON laele_schedule_queue (status, scheduled_for);

CREATE INDEX IF NOT EXISTS idx_schedule_queue_locked_until
  ON laele_schedule_queue (locked_until);
