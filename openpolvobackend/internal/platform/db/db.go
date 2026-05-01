package db

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	mysqlpkg "github.com/go-sql-driver/mysql"
	_ "modernc.org/sqlite"

	"github.com/open-polvo/open-polvo/internal/platform/config"
)

func Open(cfg config.Config) (*sql.DB, error) {
	switch strings.ToLower(strings.TrimSpace(cfg.DBDriver)) {
	case "mysql":
		return openMySQL(cfg.DBDSN)
	case "sqlite":
		return openSQLite(cfg.DBPath)
	default:
		return nil, fmt.Errorf("db: DB_DRIVER inválido: %q", cfg.DBDriver)
	}
}

func openMySQL(dsn string) (*sql.DB, error) {
	dsn = strings.TrimSpace(dsn)
	if dsn == "" {
		return nil, fmt.Errorf("db: DB_DSN vazio")
	}
	// Normaliza DSN para evitar surpresas (parseTime e multiStatements são necessários aqui).
	cfg, err := mysqlpkg.ParseDSN(dsn)
	if err != nil {
		return nil, fmt.Errorf("db: parse mysql DSN: %w", err)
	}
	cfg.ParseTime = true
	cfg.MultiStatements = true
	cfg.Loc = time.UTC

	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		return nil, err
	}
	// Defaults razoáveis para API web (ajustar por carga).
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(25)
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(1 * time.Minute)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

func openSQLite(dbPath string) (*sql.DB, error) {
	abs, err := filepath.Abs(dbPath)
	if err != nil {
		return nil, fmt.Errorf("db: resolver caminho: %w", err)
	}
	dsn := fmt.Sprintf(
		"file:%s?_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)",
		abs,
	)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// SQLite com WAL serializa escritas internamente; uma conexão na pool evita "database is locked".
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)
	db.SetConnMaxIdleTime(0)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}
