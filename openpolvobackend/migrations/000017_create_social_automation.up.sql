CREATE TABLE laele_social_automation_configs (
  id              VARCHAR(36)   NOT NULL PRIMARY KEY,
  user_id         VARCHAR(36)   NOT NULL,
  platforms_json  TEXT          NOT NULL,
  sites_json      TEXT          NOT NULL,
  times_per_day   INT           NOT NULL DEFAULT 1,
  approval_phone  VARCHAR(30)   NOT NULL DEFAULT '',
  active          TINYINT(1)    NOT NULL DEFAULT 1,
  last_run_at     DATETIME      NULL,
  created_at      DATETIME      NOT NULL,
  updated_at      DATETIME      NOT NULL,
  INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE laele_social_posts (
  id                  VARCHAR(36)   NOT NULL PRIMARY KEY,
  user_id             VARCHAR(36)   NOT NULL,
  config_id           VARCHAR(36)   NOT NULL,
  platform            VARCHAR(20)   NOT NULL,
  title               TEXT          NOT NULL,
  description         TEXT          NOT NULL,
  hashtags_json       TEXT          NOT NULL,
  image_url           TEXT,
  image_prompt        TEXT,
  source_url          TEXT,
  source_title        TEXT,
  status              VARCHAR(30)   NOT NULL DEFAULT 'pending_approval',
  published_post_id   VARCHAR(255),
  approval_sent_at    DATETIME      NULL,
  approved_at         DATETIME      NULL,
  published_at        DATETIME      NULL,
  error_msg           TEXT,
  created_at          DATETIME      NOT NULL,
  updated_at          DATETIME      NOT NULL,
  INDEX idx_user_id   (user_id),
  INDEX idx_config_id (config_id),
  INDEX idx_status    (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
