package polvointel

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	agentports "github.com/open-polvo/open-polvo/internal/agent/ports"
	"github.com/open-polvo/open-polvo/internal/conversations/domain"
)

// Client chama o serviço Python Open Polvo Intelligence (FastAPI + LangGraph).
type Client struct {
	baseURL     string
	internalKey string
	httpClient  *http.Client
}

// New devolve nil se baseURL ou internalKey estiverem vazios.
func New(baseURL, internalKey string, timeout time.Duration) *Client {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	key := strings.TrimSpace(internalKey)
	if baseURL == "" || key == "" {
		return nil
	}
	if timeout <= 0 {
		timeout = 120 * time.Second
	}
	return &Client{
		baseURL:     baseURL,
		internalKey: key,
		httpClient:  &http.Client{Timeout: timeout},
	}
}

// Configured indica se o cliente pode ser usado.
func (c *Client) Configured() bool {
	return c != nil && c.baseURL != "" && c.internalKey != ""
}

var _ agentports.ChatOrchestrator = (*Client)(nil)

// Reply implementa ChatOrchestrator.
func (c *Client) Reply(ctx context.Context, in agentports.ReplyInput) (string, map[string]any, error) {
	if !c.Configured() {
		return "", nil, fmt.Errorf("polvointel: client not configured")
	}
	type msgPart struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	body := struct {
		Messages         []msgPart                   `json:"messages"`
		ModelProvider    string                      `json:"model_provider"`
		ConversationID   string                      `json:"conversation_id,omitempty"`
		SMTPContext      *agentports.SMTPContext     `json:"smtp_context,omitempty"`
		ContactsContext  []agentports.ContactBrief   `json:"contacts_context,omitempty"`
	}{
		ModelProvider:   string(in.ModelProvider),
		SMTPContext:     in.SMTP,
		ContactsContext: in.Contacts,
	}
	for _, m := range in.Messages {
		body.Messages = append(body.Messages, msgPart{Role: m.Role, Content: m.Content})
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return "", nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/reply", bytes.NewReader(raw))
	if err != nil {
		return "", nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Open-Polvo-Internal-Key", c.internalKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", nil, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == http.StatusUnauthorized {
		return "", nil, fmt.Errorf("polvointel: unauthorized")
	}
	if resp.StatusCode == http.StatusServiceUnavailable {
		return "", nil, fmt.Errorf("polvointel: service unavailable: %s", strings.TrimSpace(string(b)))
	}
	if resp.StatusCode != http.StatusOK {
		return "", nil, fmt.Errorf("polvointel: reply %d: %s", resp.StatusCode, truncate(string(b), 500))
	}
	var out struct {
		AssistantText string         `json:"assistant_text"`
		Metadata      map[string]any `json:"metadata"`
	}
	if err := json.Unmarshal(b, &out); err != nil {
		return "", nil, fmt.Errorf("polvointel: decode reply: %w", err)
	}
	if out.Metadata == nil {
		out.Metadata = map[string]any{}
	}
	return out.AssistantText, out.Metadata, nil
}

// GenerateGraphJSON gera texto bruto JSON do grafo (Go faz o parse).
func (c *Client) GenerateGraphJSON(ctx context.Context, provider domain.ModelProvider, userRequest, recordingJSON string) (string, error) {
	if !c.Configured() {
		return "", fmt.Errorf("polvointel: client not configured")
	}
	body, err := json.Marshal(map[string]string{
		"model_provider": string(provider),
		"prompt":         userRequest,
		"recording_json": recordingJSON,
	})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/workflows/generate", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Open-Polvo-Internal-Key", c.internalKey)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("polvointel: generate %d: %s", resp.StatusCode, truncate(string(b), 500))
	}
	var out struct {
		RawLLM string `json:"raw_llm"`
	}
	if err := json.Unmarshal(b, &out); err != nil {
		return "", err
	}
	return out.RawLLM, nil
}

// GenerateText uma chamada LLM simples (nós llm no runner de workflows).
func (c *Client) GenerateText(ctx context.Context, provider domain.ModelProvider, system, user string) (string, error) {
	if !c.Configured() {
		return "", fmt.Errorf("polvointel: client not configured")
	}
	body, err := json.Marshal(map[string]string{
		"model_provider": string(provider),
		"system":         system,
		"user":           user,
	})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/llm/generate-text", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Open-Polvo-Internal-Key", c.internalKey)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("polvointel: llm text %d: %s", resp.StatusCode, truncate(string(b), 500))
	}
	var out struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(b, &out); err != nil {
		return "", err
	}
	return out.Text, nil
}

// Readyz chama GET /readyz.
func (c *Client) Readyz(ctx context.Context) error {
	if !c.Configured() {
		return fmt.Errorf("polvointel: not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/readyz", nil)
	if err != nil {
		return err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("readyz: %d %s", resp.StatusCode, truncate(string(b), 200))
	}
	return nil
}

// CapabilitiesResponse espelha GET /v1/capabilities.
type CapabilitiesResponse struct {
	OpenAIConfigured bool `json:"openai_configured"`
	GoogleConfigured bool `json:"google_configured"`
}

// Capabilities chama GET /v1/capabilities.
func (c *Client) Capabilities(ctx context.Context) (CapabilitiesResponse, error) {
	var z CapabilitiesResponse
	if !c.Configured() {
		return z, fmt.Errorf("polvointel: not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/v1/capabilities", nil)
	if err != nil {
		return z, err
	}
	req.Header.Set("X-Open-Polvo-Internal-Key", c.internalKey)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return z, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return z, fmt.Errorf("capabilities: %d", resp.StatusCode)
	}
	if err := json.Unmarshal(b, &z); err != nil {
		return z, err
	}
	return z, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
