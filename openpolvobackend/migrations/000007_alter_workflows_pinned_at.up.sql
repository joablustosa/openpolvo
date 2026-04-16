-- Idempotente: em alguns ambientes a coluna pode já existir.
SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'laele_workflows'
    AND COLUMN_NAME = 'pinned_at'
);

SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE laele_workflows ADD COLUMN pinned_at DATETIME(3) NULL AFTER graph_json',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
