package migrate

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/open-polvo/open-polvo/internal/platform/repo"
)

// ResolveMigrationsDir torna o caminho absoluto e fiável: se for relativo, junta à raiz do
// módulo Go (directório com go.mod) a partir do cwd.
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

// Apply executa todas as migrações *.up.sql ainda não aplicadas.
// Usa a pool existente — não abre nem fecha ligação adicional.
func Apply(db *sql.DB, absoluteMigrationsDir string) error {
	abs := filepath.Clean(absoluteMigrationsDir)
	if err := verifyMigrationsDir(abs); err != nil {
		return err
	}

	ctx := context.Background()

	if _, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    INTEGER NOT NULL PRIMARY KEY,
			applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`); err != nil {
		return fmt.Errorf("migrate: criar schema_migrations: %w", err)
	}

	files, err := listMigrationFiles(abs)
	if err != nil {
		return err
	}

	for _, f := range files {
		version, err := versionFromFilename(f.name)
		if err != nil {
			return err
		}

		var count int
		if err := db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, version,
		).Scan(&count); err != nil {
			return fmt.Errorf("migrate: verificar versão %d: %w", version, err)
		}
		if count > 0 {
			continue
		}

		content, err := os.ReadFile(f.path)
		if err != nil {
			return fmt.Errorf("migrate: ler %s: %w", f.name, err)
		}

		if err := execMigration(ctx, db, string(content)); err != nil {
			return fmt.Errorf("migrate: executar %s: %w", f.name, err)
		}

		if _, err := db.ExecContext(ctx,
			`INSERT INTO schema_migrations (version) VALUES (?)`, version,
		); err != nil {
			return fmt.Errorf("migrate: registar versão %d: %w", version, err)
		}
	}
	return nil
}

// Up resolve o caminho das migrações e aplica-as.
func Up(db *sql.DB, migrationsDir string) error {
	abs, err := ResolveMigrationsDir(migrationsDir)
	if err != nil {
		return err
	}
	return Apply(db, abs)
}

func execMigration(ctx context.Context, db *sql.DB, content string) error {
	for _, stmt := range splitStatements(content) {
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("statement falhou: %w\nSQL: %.300s", err, stmt)
		}
	}
	return nil
}

// splitStatements divide SQL por ';', remove comentários de linha e ignora vazios.
func splitStatements(content string) []string {
	parts := strings.Split(content, ";")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		lines := strings.Split(p, "\n")
		filtered := lines[:0]
		for _, line := range lines {
			if !strings.HasPrefix(strings.TrimSpace(line), "--") {
				filtered = append(filtered, line)
			}
		}
		stmt := strings.TrimSpace(strings.Join(filtered, "\n"))
		if stmt != "" {
			out = append(out, stmt)
		}
	}
	return out
}

type migrationFile struct {
	name string
	path string
}

func listMigrationFiles(dir string) ([]migrationFile, error) {
	var files []migrationFile
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		name := d.Name()
		if strings.HasSuffix(strings.ToLower(name), ".up.sql") {
			files = append(files, migrationFile{name: name, path: path})
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("migrate: listar ficheiros: %w", err)
	}
	sort.Slice(files, func(i, j int) bool {
		return files[i].name < files[j].name
	})
	return files, nil
}

func versionFromFilename(name string) (int64, error) {
	parts := strings.SplitN(name, "_", 2)
	if len(parts) == 0 {
		return 0, fmt.Errorf("migrate: nome de ficheiro inválido: %s", name)
	}
	v, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("migrate: versão inválida em %s: %w", name, err)
	}
	return v, nil
}
