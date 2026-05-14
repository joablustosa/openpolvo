CREATE TABLE IF NOT EXISTS laele_social_automation_configs (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  platforms_json JSON NOT NULL,
  sites_json JSON NOT NULL,
  times_per_day INT NOT NULL DEFAULT 1,
  approval_phone TEXT NOT NULL DEFAULT '',
  active TINYINT(1) NOT NULL DEFAULT 1,
  last_run_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (user_id) REFERENCES laele_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_laele_social_automation_configs_user ON laele_social_automation_configs (user_id);

CREATE TABLE IF NOT EXISTS laele_social_posts (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  config_id VARCHAR(36) NOT NULL,
  platform VARCHAR(32) NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  hashtags_json JSON NOT NULL,
  image_url TEXT,
  image_prompt TEXT,
  source_url TEXT,
  source_title TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'pending_approval',
  published_post_id TEXT,
  approval_sent_at DATETIME(3) NULL,
  approved_at DATETIME(3) NULL,
  published_at DATETIME(3) NULL,
  error_msg TEXT,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (user_id) REFERENCES laele_users(id) ON DELETE CASCADE,
  FOREIGN KEY (config_id) REFERENCES laele_social_automation_configs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_laele_social_posts_user ON laele_social_posts (user_id);
CREATE INDEX idx_laele_social_posts_config ON laele_social_posts (config_id);
CREATE INDEX idx_laele_social_posts_status ON laele_social_posts (status);
