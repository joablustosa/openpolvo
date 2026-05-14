package migrate

import (
	"database/sql"
	"fmt"
	"strings"
)

func isSQLiteDriver(db *sql.DB) bool {
	if db == nil {
		return false
	}
	t := fmt.Sprintf("%T", db.Driver())
	t = strings.ToLower(t)
	return strings.Contains(t, "sqlite")
}

// isBenignSQLiteMigrationError evita falha ao re-aplicar migrações após execução parcial (ex.: coluna já existe).
func isBenignSQLiteMigrationError(err error, stmt string) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	st := strings.ToUpper(strings.TrimSpace(stmt))
	if strings.HasPrefix(st, "ALTER TABLE") && strings.Contains(st, "ADD COLUMN") {
		if strings.Contains(msg, "duplicate column name") {
			return true
		}
	}
	if strings.HasPrefix(st, "CREATE INDEX") || strings.HasPrefix(st, "CREATE UNIQUE INDEX") {
		if strings.Contains(msg, "already exists") {
			return true
		}
	}
	return false
}

// normalizeStatementForSQLite adapta DDL/DML escrito para MySQL a sintaxe aceite pelo SQLite (modernc.org/sqlite).
// Mantém-se o texto original para MySQL.
func normalizeStatementForSQLite(stmt string) string {
	s := stmt
	// Ordem importa: remover ON UPDATE antes de tocar em CURRENT_TIMESTAMP(3) genérico.
	s = strings.ReplaceAll(s, " ON UPDATE CURRENT_TIMESTAMP(3)", "")
	s = strings.ReplaceAll(s, " ON UPDATE CURRENT_TIMESTAMP", "")
	s = strings.ReplaceAll(s, "CURRENT_TIMESTAMP(3)", "CURRENT_TIMESTAMP")
	// Sufixo de tabela MySQL
	s = strings.ReplaceAll(s, ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4", ")")
	// INSERT IGNORE → INSERT OR IGNORE (MySQL vs SQLite)
	s = strings.ReplaceAll(s, "INSERT IGNORE INTO", "INSERT OR IGNORE INTO")
	s = strings.ReplaceAll(s, "insert ignore into", "INSERT OR IGNORE INTO")
	return s
}
