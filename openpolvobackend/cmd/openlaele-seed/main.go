package main

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	platformcfg "github.com/open-polvo/open-polvo/internal/platform/config"
	platformdb "github.com/open-polvo/open-polvo/internal/platform/db"
	platformmigrate "github.com/open-polvo/open-polvo/internal/platform/migrate"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

	email := os.Getenv("SEED_ADMIN_EMAIL")
	password := os.Getenv("SEED_ADMIN_PASSWORD")
	if email == "" || password == "" {
		slog.Error("set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD")
		os.Exit(1)
	}

	cfg, err := platformcfg.Load()
	if err != nil {
		slog.Error("config", "err", err)
		os.Exit(1)
	}

	db, err := platformdb.Open(cfg)
	if err != nil {
		slog.Error("db", "err", err)
		os.Exit(1)
	}
	defer db.Close()

	if cfg.RunMigrations {
		if err := platformmigrate.Up(db, cfg.MigrationsPath); err != nil {
			slog.Error("migrations", "err", err)
			os.Exit(1)
		}
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		slog.Error("hash", "err", err)
		os.Exit(1)
	}

	id := uuid.New()
	now := time.Now().UTC()
	ctx := context.Background()
	_, err = db.ExecContext(ctx,
		`INSERT INTO laele_users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
		 VALUES (?, ?, ?, ?, ?) AS new
		 ON DUPLICATE KEY UPDATE password_hash = new.password_hash, updated_at = new.updated_at`,
		id.String(), email, string(hash), now, now,
	)
	if err != nil {
		slog.Error("insert user", "err", err)
		os.Exit(1)
	}
	slog.Info("seed ok", "email", email)
}
