package repo

import (
	"fmt"
	"os"
	"path/filepath"
)

// ModuleRoot devolve o directório que contém go.mod, a partir do cwd atual.
func ModuleRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		goMod := filepath.Join(dir, "go.mod")
		st, err := os.Stat(goMod)
		if err == nil && !st.IsDir() {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("go.mod não encontrado a partir de %s", dir)
		}
		dir = parent
	}
}
