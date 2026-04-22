CREATE TABLE laele_user_meta_settings (
  user_id                    VARCHAR(36)  NOT NULL PRIMARY KEY,
  app_id                     VARCHAR(255) NOT NULL DEFAULT '',
  app_secret_enc             BLOB,
  wa_phone_number_id         VARCHAR(255) NOT NULL DEFAULT '',
  wa_access_token_enc        BLOB,
  fb_page_id                 VARCHAR(255) NOT NULL DEFAULT '',
  fb_page_token_enc          BLOB,
  ig_account_id              VARCHAR(255) NOT NULL DEFAULT '',
  ig_access_token_enc        BLOB,
  webhook_verify_token       VARCHAR(255) NOT NULL DEFAULT '',
  updated_at                 DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
