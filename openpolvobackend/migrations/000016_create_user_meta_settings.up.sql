CREATE TABLE IF NOT EXISTS laele_user_meta_settings (
  user_id TEXT NOT NULL PRIMARY KEY,
  app_id TEXT NOT NULL DEFAULT '',
  app_secret_enc BLOB,
  wa_phone_number_id TEXT NOT NULL DEFAULT '',
  wa_access_token_enc BLOB,
  fb_page_id TEXT NOT NULL DEFAULT '',
  fb_page_token_enc BLOB,
  ig_account_id TEXT NOT NULL DEFAULT '',
  ig_access_token_enc BLOB,
  webhook_verify_token TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
