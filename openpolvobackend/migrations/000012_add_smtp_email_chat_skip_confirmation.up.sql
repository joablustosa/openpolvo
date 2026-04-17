-- Idempotente: não falha se a coluna já existir (re-arranques / BD já actualizada).
SET @db := DATABASE();
SET @exist := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db
    AND table_name = 'laele_user_smtp_settings'
    AND column_name = 'email_chat_skip_confirmation'
);
SET @sql := IF(
  @exist = 0,
  'ALTER TABLE laele_user_smtp_settings ADD COLUMN email_chat_skip_confirmation TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''1 = envio pelo chat sem pedir confirmacao ao utilizador'' AFTER use_tls',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
