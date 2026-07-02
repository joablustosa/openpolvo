package engine

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestIsSafePublicURL(t *testing.T) {
	blocked := []string{
		"http://localhost/x", "http://127.0.0.1/x", "https://10.0.0.1/x",
		"https://192.168.1.1/x", "http://169.254.169.254/latest/meta-data",
		"ftp://example.com", "http://foo.local/x", "not-a-url",
	}
	for _, u := range blocked {
		if isSafePublicURL(u) {
			t.Errorf("deveria bloquear: %s", u)
		}
	}
	allowed := []string{"https://api.example.com/v1", "http://example.com"}
	for _, u := range allowed {
		if !isSafePublicURL(u) {
			t.Errorf("deveria permitir: %s", u)
		}
	}
}

func TestDoHTTPRequest_GET(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Test") != "abc" {
			t.Errorf("header não propagado: %q", r.Header.Get("X-Test"))
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	out, err := httpRequest(context.Background(), "GET", srv.URL, map[string]string{"X-Test": "abc"}, "")
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if out != `{"ok":true}` {
		t.Fatalf("corpo inesperado: %q", out)
	}
}

func TestDoHTTPRequest_POSTBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(body)
		if string(body) != `{"q":1}` {
			t.Errorf("body inesperado: %q", string(body))
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("content-type padrão não aplicado")
		}
		w.WriteHeader(201)
		_, _ = w.Write([]byte("created"))
	}))
	defer srv.Close()

	out, err := httpRequest(context.Background(), "POST", srv.URL, nil, `{"q":1}`)
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if out != "created" {
		t.Fatalf("corpo inesperado: %q", out)
	}
}

func TestDoHTTPRequest_ErrorStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(500)
		_, _ = w.Write([]byte("boom"))
	}))
	defer srv.Close()

	_, err := httpRequest(context.Background(), "GET", srv.URL, nil, "")
	if err == nil {
		t.Fatal("esperava erro para status 500")
	}
}

func TestDoHTTPRequest_BlocksSSRF(t *testing.T) {
	_, err := doHTTPRequest(context.Background(), "GET", "http://127.0.0.1:9999/", nil, "")
	if err == nil {
		t.Fatal("esperava bloqueio SSRF")
	}
}

func TestWithRetry_SucceedsAfterFailures(t *testing.T) {
	calls := 0
	err := withRetry(context.Background(), 3, 1, func() error {
		calls++
		if calls < 3 {
			return errors.New("falha temporária")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("esperava sucesso, obtive %v", err)
	}
	if calls != 3 {
		t.Fatalf("esperava 3 tentativas, obtive %d", calls)
	}
}

func TestWithRetry_ExhaustsAndReturnsLastError(t *testing.T) {
	calls := 0
	err := withRetry(context.Background(), 2, 1, func() error {
		calls++
		return errors.New("sempre falha")
	})
	if err == nil {
		t.Fatal("esperava erro após esgotar tentativas")
	}
	if calls != 3 { // 1 + 2 retries
		t.Fatalf("esperava 3 tentativas, obtive %d", calls)
	}
}

func TestWithRetry_NoRetryRunsOnce(t *testing.T) {
	calls := 0
	_ = withRetry(context.Background(), 0, 0, func() error {
		calls++
		return errors.New("x")
	})
	if calls != 1 {
		t.Fatalf("esperava 1 tentativa, obtive %d", calls)
	}
}
