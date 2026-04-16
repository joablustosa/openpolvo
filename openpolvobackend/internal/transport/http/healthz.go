package httptransport

import (
	"context"
	"net/http"
	"time"

	"github.com/open-polvo/open-polvo/internal/platform/buildinfo"
)

// GetHealthz liveness: confirma que o processo HTTP responde (sem dependências externas).
func (d Deps) GetHealthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"service": buildinfo.ServiceName,
		"version": buildinfo.Version,
	})
}

// GetReadyz readiness: verifica dependências (ex.: ping MySQL).
func (d Deps) GetReadyz(w http.ResponseWriter, r *http.Request) {
	checks := map[string]string{"http": "ok"}

	if d.ReadyCheck == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"status": "ready",
			"checks": checks,
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	if err := d.ReadyCheck(ctx); err != nil {
		checks["dependencies"] = "error"
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"status": "not_ready",
			"checks": checks,
		})
		return
	}

	checks["dependencies"] = "ok"
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ready",
		"checks": checks,
	})
}
