package httptransport

import (
	"net/http"
	"net/http/httptest"
	"testing"

	platformcfg "github.com/open-polvo/open-polvo/internal/platform/config"
)

func TestDeps_GetHealthz(t *testing.T) {
	d := Deps{Config: platformcfg.Config{}}
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	d.GetHealthz(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Fatalf("content-type %q", ct)
	}
}

func TestDeps_GetReadyz_noReadyCheck(t *testing.T) {
	d := Deps{Config: platformcfg.Config{}, ReadyCheck: nil}
	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	rec := httptest.NewRecorder()
	d.GetReadyz(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
}
