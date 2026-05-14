package migrate

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestApply_AllMigrations_SQLiteMemory(t *testing.T) {
	db, err := sql.Open("sqlite", "file:migrate_full_test?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.ExecContext(context.Background(), `PRAGMA foreign_keys = ON`); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join("..", "..", "..", "migrations")
	if err := Apply(db, dir); err != nil {
		t.Fatalf("Apply: %v", err)
	}
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM laele_finance_categories WHERE 1=0`).Scan(&n); err != nil {
		t.Fatalf("finance categories table: %v", err)
	}
}
