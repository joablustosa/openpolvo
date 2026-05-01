package sqliterepo

import (
	"context"
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"

	platformcfg "github.com/open-polvo/open-polvo/internal/platform/config"
)

func TestRepository_CreateProfile_InMemorySQLite(t *testing.T) {
	db, err := sql.Open("sqlite", "file:llmprof_test_mem?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.ExecContext(context.Background(), `PRAGMA foreign_keys = ON`); err != nil {
		t.Fatal(err)
	}
	r := &Repository{DB: db, Cfg: platformcfg.Config{JWTSecret: "unit-test-jwt-secret-not-for-prod"}}
	id, err := r.CreateProfile(context.Background(), "P", "openai", "gpt-4o-mini", 0, "sk-test-key-12345678901234567890")
	if err != nil {
		t.Fatalf("CreateProfile: %v", err)
	}
	if id.String() == "" {
		t.Fatal("empty id")
	}
	p, err := r.GetProfileByID(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	if p.DisplayName != "P" || p.ModelID != "gpt-4o-mini" {
		t.Fatalf("unexpected row %+v", p)
	}
}

func TestRepository_CreateProfile_WithLegacyNarrowTable(t *testing.T) {
	db, err := sql.Open("sqlite", "file:llmprof_legacy_mem?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	if _, err := db.ExecContext(ctx, `PRAGMA foreign_keys = ON`); err != nil {
		t.Fatal(err)
	}
	// Simula BD antiga: tabela existe mas sem colunas esperadas pelo INSERT actual.
	if _, err := db.ExecContext(ctx, `CREATE TABLE laele_llm_profiles (id TEXT PRIMARY KEY)`); err != nil {
		t.Fatal(err)
	}
	r := &Repository{DB: db, Cfg: platformcfg.Config{JWTSecret: "unit-test-jwt-secret-not-for-prod"}}
	_, err = r.CreateProfile(ctx, "P", "openai", "gpt-4o-mini", 0, "sk-test-key-12345678901234567890")
	if err != nil {
		t.Fatalf("CreateProfile after column repair: %v", err)
	}
}
