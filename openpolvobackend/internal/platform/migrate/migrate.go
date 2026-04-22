package migrate

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/golang-migrate/migrate/v4"
	migratemysql "github.com/golang-migrate/migrate/v4/database/mysql"
	_ "github.com/golang-migrate/migrate/v4/source/file"

	platformdb "github.com/open-polvo/open-polvo/internal/platform/db"
	"github.com/open-polvo/open-polvo/internal/platform/repo"
)

// ResolveMigrationsDir torna o caminho absoluto e fiável: se for relativo, junta à raiz do
// módulo Go (directório com go.mod) a partir do cwd, para as migrações correrem mesmo que
// o processo não tenha sido iniciado na raiz do repositório.
func ResolveMigrationsDir(relOrAbs string) (string, error) {
	relOrAbs = strings.TrimSpace(relOrAbs)
	if relOrAbs == "" {
		relOrAbs = "migrations"
	}
	if filepath.IsAbs(relOrAbs) {
		if err := verifyMigrationsDir(relOrAbs); err != nil {
			return "", fmt.Errorf("migrations: %w", err)
		}
		return filepath.Clean(relOrAbs), nil
	}
	root, err := repo.ModuleRoot()
	if err != nil {
		// Fallback: cwd (comportamento antigo)
		abs, aerr := filepath.Abs(relOrAbs)
		if aerr != nil {
			return "", fmt.Errorf("migrations: %w", aerr)
		}
		if verr := verifyMigrationsDir(abs); verr != nil {
			return "", fmt.Errorf("migrations: não encontrada pasta com *.up.sql (cwd=%q rel=%q): %v", mustGetwd(), relOrAbs, verr)
		}
		return abs, nil
	}
	abs := filepath.Join(root, relOrAbs)
	if err := verifyMigrationsDir(abs); err != nil {
		return "", fmt.Errorf("migrations: %w", err)
	}
	return abs, nil
}

func mustGetwd() string {
	wd, err := os.Getwd()
	if err != nil {
		return "?"
	}
	return wd
}

func verifyMigrationsDir(abs string) error {
	st, err := os.Stat(abs)
	if err != nil {
		return err
	}
	if !st.IsDir() {
		return fmt.Errorf("%s não é um directório", abs)
	}
	var found bool
	_ = filepath.WalkDir(abs, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if strings.HasSuffix(strings.ToLower(d.Name()), ".up.sql") {
			found = true
			return fs.SkipAll
		}
		return nil
	})
	if !found {
		return fmt.Errorf("nenhum ficheiro *.up.sql em %s", abs)
	}
	return nil
}

// fileSourceURI URI aceite pelo driver file do golang-migrate (Windows e Unix).
// Em Windows, evitar file:///C:/... : net/url interpreta o path como "/C:/..." e
// os.DirFS falha com "syntax error" — usar file://C:/... (dois slashes após file:).
func fileSourceURI(abs string) string {
	abs = filepath.Clean(abs)
	s := filepath.ToSlash(abs)
	if len(s) >= 2 && s[1] == ':' {
		return "file://" + s
	}
	if strings.HasPrefix(s, "/") {
		return "file://" + s
	}
	return "file:///" + s
}

// ensureMultiStatements garante que o DSN permite vários statements por ficheiro
// de migração (ex.: vários CREATE TABLE no mesmo .up.sql), como esperado pelo
// golang-migrate com MySQL.
func ensureMultiStatements(dsn string) string {
	dsn = strings.TrimSpace(dsn)
	if dsn == "" || strings.Contains(dsn, "multiStatements=true") {
		return dsn
	}
	sep := "?"
	if strings.Contains(dsn, "?") {
		sep = "&"
	}
	return dsn + sep + "multiStatements=true"
}

// Apply executa migrate up. Abre uma ligação MySQL dedicada e fecha-a no fim: o
// golang-migrate chama Close() no driver, o que fecha o *sql.DB passado a
// WithInstance — não usar a pool da aplicação.
func Apply(mysqlDSN string, absoluteMigrationsDir string) error {
	abs := filepath.Clean(absoluteMigrationsDir)
	if err := verifyMigrationsDir(abs); err != nil {
		return err
	}
	db, err := platformdb.Open(ensureMultiStatements(mysqlDSN))
	if err != nil {
		return fmt.Errorf("migrate: connect: %w", err)
	}
	driver, err := migratemysql.WithInstance(db, &migratemysql.Config{})
	if err != nil {
		_ = db.Close()
		return fmt.Errorf("migrate mysql driver: %w", err)
	}
	uri := fileSourceURI(abs)
	m, err := migrate.NewWithDatabaseInstance(uri, "mysql", driver)
	if err != nil {
		_ = db.Close()
		return fmt.Errorf("migrate: %w", err)
	}
	defer func() { _, _ = m.Close() }()
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return err
	}
	return nil
}

// Up resolve o caminho das migrações (go.mod / cwd) e aplica-as.
func Up(mysqlDSN string, migrationsDir string) error {
	abs, err := ResolveMigrationsDir(migrationsDir)
	if err != nil {
		return err
	}
	return Apply(mysqlDSN, abs)
}
