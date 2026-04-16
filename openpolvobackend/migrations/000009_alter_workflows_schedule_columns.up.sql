-- Agendamento de workflows (cron no servidor Go; ver WORKFLOW_SCHEDULER_* no .env).
ALTER TABLE laele_workflows
  ADD COLUMN schedule_cron VARCHAR(128) NULL DEFAULT NULL,
  ADD COLUMN schedule_timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  ADD COLUMN schedule_enabled TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN schedule_last_fired_at DATETIME(3) NULL DEFAULT NULL;
