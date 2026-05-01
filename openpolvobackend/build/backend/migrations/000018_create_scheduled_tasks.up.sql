CREATE TABLE IF NOT EXISTS laele_scheduled_tasks (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NULL,
  task_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  cron_expr TEXT NOT NULL,
  timezone TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT NULL,
  last_result TEXT NULL,
  last_error TEXT NULL,
  run_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_laele_sched_user_active ON laele_scheduled_tasks (user_id, active);
