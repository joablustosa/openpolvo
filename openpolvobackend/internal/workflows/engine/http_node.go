package engine

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	httpNodeTimeout   = 20 * time.Second
	httpNodeMaxBytes  = 512 * 1024
	httpNodeMaxOutput = 24_000
)

// isSafePublicURL bloqueia SSRF óbvio: só http/https públicos (sem localhost, IP
// privado, link-local ou metadata).
func isSafePublicURL(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return false
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	if host == "" {
		return false
	}
	switch host {
	case "localhost", "127.0.0.1", "0.0.0.0", "::1":
		return false
	}
	if strings.HasSuffix(host, ".local") {
		return false
	}
	if ip := net.ParseIP(host); ip != nil {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
			return false
		}
	}
	return true
}

// doHTTPRequest aplica o guard SSRF e executa o pedido do nó `http`.
func doHTTPRequest(ctx context.Context, method, rawURL string, headers map[string]string, body string) (string, error) {
	if !isSafePublicURL(rawURL) {
		return "", fmt.Errorf("URL não permitida (apenas http/https públicos)")
	}
	return httpRequest(ctx, method, rawURL, headers, body)
}

// httpRequest executa o pedido e devolve o corpo (texto, truncado). Erro em falha de
// rede ou status >= 400. Não valida SSRF — usar via doHTTPRequest.
func httpRequest(ctx context.Context, method, rawURL string, headers map[string]string, body string) (string, error) {
	m := strings.ToUpper(strings.TrimSpace(method))
	if m == "" {
		m = http.MethodGet
	}
	switch m {
	case http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodHead:
	default:
		return "", fmt.Errorf("método HTTP não permitido: %s", m)
	}
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	reqCtx, cancel := context.WithTimeout(ctx, httpNodeTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, m, rawURL, reader)
	if err != nil {
		return "", err
	}
	for k, v := range headers {
		if strings.TrimSpace(k) != "" {
			req.Header.Set(k, v)
		}
	}
	if body != "" && req.Header.Get("Content-Type") == "" {
		req.Header.Set("Content-Type", "application/json")
	}
	client := &http.Client{Timeout: httpNodeTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, httpNodeMaxBytes))
	text := string(raw)
	if len(text) > httpNodeMaxOutput {
		text = text[:httpNodeMaxOutput] + "\n… (truncado)"
	}
	if resp.StatusCode >= 400 {
		return text, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return text, nil
}

// withRetry corre fn até (1+retries) vezes, esperando delayMs entre tentativas.
// Devolve o erro da última tentativa. retries<=0 → uma única tentativa.
func withRetry(ctx context.Context, retries, delayMs int, fn func() error) error {
	attempts := retries + 1
	if attempts < 1 {
		attempts = 1
	}
	var err error
	for i := 0; i < attempts; i++ {
		if err = fn(); err == nil {
			return nil
		}
		if i < attempts-1 {
			d := time.Duration(delayMs) * time.Millisecond
			if d <= 0 {
				d = 500 * time.Millisecond
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(d):
			}
		}
	}
	return err
}
