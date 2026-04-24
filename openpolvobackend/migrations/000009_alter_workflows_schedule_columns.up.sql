ALTER TABLE laele_workflows ADD COLUMN schedule_cron TEXT NULL DEFAULT NULL;
ALTER TABLE laele_workflows ADD COLUMN schedule_timezone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE laele_workflows ADD COLUMN schedule_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE laele_workflows ADD COLUMN schedule_last_fired_at DATETIME NULL DEFAULT NULL;
