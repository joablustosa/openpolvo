CREATE TABLE IF NOT EXISTS laele_social_automation_configs (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  platforms_json TEXT NOT NULL,
  sites_json TEXT NOT NULL,
  times_per_day INTEGER NOT NULL DEFAULT 1,
  approval_phone TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_laele_social_automation_configs_user ON laele_social_automation_configs (user_id);

CREATE TABLE IF NOT EXISTS laele_social_posts (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  config_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  hashtags_json TEXT NOT NULL,
  image_url TEXT,
  image_prompt TEXT,
  source_url TEXT,
  source_title TEXT,
  status TEXT NOT NULL DEFAULT 'pending_approval',
  published_post_id TEXT,
  approval_sent_at TEXT NULL,
  approved_at TEXT NULL,
  published_at TEXT NULL,
  error_msg TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_laele_social_posts_user ON laele_social_posts (user_id);
CREATE INDEX IF NOT EXISTS idx_laele_social_posts_config ON laele_social_posts (config_id);
CREATE INDEX IF NOT EXISTS idx_laele_social_posts_status ON laele_social_posts (status);
