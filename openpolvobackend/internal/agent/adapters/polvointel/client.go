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
	wfports "github.com/open-polvo/open-polvo/internal/workflows/ports"
)

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
	raw, err := marshalReplyBody(in)
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
		return "", nil, wrapTransportError(err)
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
func (c *Client) GenerateGraphJSON(ctx context.Context, provider domain.ModelProvider, ov wfports.LLMOverrides, userRequest, recordingJSON string) (string, error) {
	if !c.Configured() {
		return "", fmt.Errorf("polvointel: client not configured")
	}
	body, err := json.Marshal(map[string]string{
		"model_provider": string(provider),
		"prompt":         userRequest,
		"recording_json": recordingJSON,
		"openai_api_key": ov.OpenAIAPIKey,
		"google_api_key": ov.GoogleAPIKey,
		"openai_model":   ov.OpenAIModel,
		"google_model":   ov.GoogleModel,
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
func (c *Client) GenerateText(ctx context.Context, provider domain.ModelProvider, ov wfports.LLMOverrides, system, user string) (string, error) {
	if !c.Configured() {
		return "", fmt.Errorf("polvointel: client not configured")
	}
	body, err := json.Marshal(map[string]string{
		"model_provider": string(provider),
		"system":         system,
		"user":           user,
		"openai_api_key": ov.OpenAIAPIKey,
		"google_api_key": ov.GoogleAPIKey,
		"openai_model":   ov.OpenAIModel,
		"google_model":   ov.GoogleModel,
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
	if resp.StatusCode == http.StatusUnauthorized {
		return "", fmt.Errorf("polvointel: llm text unauthorized (defina a mesma chave em POLVO_INTELLIGENCE_INTERNAL_KEY na API Go e POLVO_INTERNAL_KEY no Intelligence)")
	}
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

var _ wfports.WebSearchEnricher = (*Client)(nil)

// EnrichWebSearch aprofunda URLs dos orgânicos SerpAPI (trafilatura + agente por site no Intelligence).
func (c *Client) EnrichWebSearch(
	ctx context.Context,
	provider domain.ModelProvider,
	ov wfports.LLMOverrides,
	in wfports.WebSearchEnrichInput,
) (string, error) {
	if !c.Configured() {
		return "", fmt.Errorf("polvointel: client not configured")
	}
	rows := make([]map[string]string, 0, len(in.Results))
	for _, r := range in.Results {
		rows = append(rows, map[string]string{
			"title":   r.Title,
			"link":    r.Link,
			"snippet": r.Snippet,
		})
	}
	payload := map[string]any{
		"model_provider":  string(provider),
		"openai_api_key":  ov.OpenAIAPIKey,
		"google_api_key":  ov.GoogleAPIKey,
		"openai_model":    ov.OpenAIModel,
		"google_model":    ov.GoogleModel,
		"query":           in.Query,
		"engine":          in.Engine,
		"organic_results": rows,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/workflows/web-search-enrich", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Open-Polvo-Internal-Key", c.internalKey)
	enrichClient := &http.Client{Timeout: 4 * time.Minute}
	resp, err := enrichClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("polvointel: web-search-enrich %d: %s", resp.StatusCode, truncate(string(b), 500))
	}
	var out struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(b, &out); err != nil {
		return "", err
	}
	return out.Text, nil
}

// ReplyStream abre uma ligação SSE ao Python /v1/reply/stream e devolve o
// corpo da resposta para proxy. Usa um cliente HTTP sem timeout para suportar
// streams de longa duração (sub-grafo Builder pode levar vários minutos).
// O caller é responsável por fechar o ReadCloser devolvido.
func (c *Client) ReplyStream(ctx context.Context, in agentports.ReplyInput) (io.ReadCloser, error) {
	if !c.Configured() {
		return nil, fmt.Errorf("polvointel: client not configured")
	}
	raw, err := marshalReplyBody(in)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/reply/stream", bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("X-Open-Polvo-Internal-Key", c.internalKey)

	// Cliente sem timeout: a ligação SSE pode durar vários minutos.
	streamClient := &http.Client{}
	resp, err := streamClient.Do(req)
	if err != nil {
		return nil, wrapTransportError(err)
	}
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		return nil, fmt.Errorf("polvointel: stream %d: %s", resp.StatusCode, truncate(string(b), 500))
	}
	return resp.Body, nil
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
		return wrapTransportError(err)
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

// DevStudioSelfHealInput pedido de correcção automática de erros de build.
type DevStudioSelfHealInput struct {
	ModelProvider      string
	ConversationID     string
	UserPrompt         string
	CompileLog         string
	PreviewConsoleLogs []map[string]any
	ProjectFiles       map[string]string
	DevStudioContext   map[string]any
}

// DevStudioSelfHeal chama POST /v1/dev-studio/self-heal no Intelligence.
func (c *Client) DevStudioSelfHeal(ctx context.Context, in DevStudioSelfHealInput) (string, map[string]any, error) {
	if !c.Configured() {
		return "", nil, fmt.Errorf("polvointel: not configured")
	}
	body := map[string]any{
		"model_provider": in.ModelProvider,
	}
	if strings.TrimSpace(in.ConversationID) != "" {
		body["conversation_id"] = strings.TrimSpace(in.ConversationID)
	}
	if strings.TrimSpace(in.UserPrompt) != "" {
		body["user_prompt"] = in.UserPrompt
	}
	if strings.TrimSpace(in.CompileLog) != "" {
		body["compile_log"] = in.CompileLog
	}
	if len(in.PreviewConsoleLogs) > 0 {
		body["preview_console_logs"] = in.PreviewConsoleLogs
	}
	if len(in.ProjectFiles) > 0 {
		body["project_files"] = in.ProjectFiles
	}
	if len(in.DevStudioContext) > 0 {
		body["dev_studio_context"] = in.DevStudioContext
	}
	if in.ModelProvider == "" {
		body["model_provider"] = "openai"
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return "", nil, err
	}
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.baseURL+"/v1/dev-studio/self-heal",
		bytes.NewReader(raw),
	)
	if err != nil {
		return "", nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Open-Polvo-Internal-Key", c.internalKey)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", nil, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", nil, fmt.Errorf("dev-studio self-heal: %d %s", resp.StatusCode, truncate(string(b), 300))
	}
	var out struct {
		AssistantText string         `json:"assistant_text"`
		Metadata      map[string]any `json:"metadata"`
	}
	if err := json.Unmarshal(b, &out); err != nil {
		return "", nil, err
	}
	meta := out.Metadata
	if meta == nil {
		meta = map[string]any{}
	}
	return out.AssistantText, meta, nil
}

// SubmitDeskToolResult envia resultado de tool executada no desktop para o grafo Desk.
func (c *Client) SubmitDeskToolResult(
	ctx context.Context,
	conversationID, callID string,
	result map[string]any,
) error {
	if !c.Configured() {
		return fmt.Errorf("polvointel: client not configured")
	}
	body, err := json.Marshal(map[string]any{
		"conversation_id": conversationID,
		"call_id":         callID,
		"result":          result,
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.baseURL+"/v1/desk/tool-result",
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Open-Polvo-Internal-Key", c.internalKey)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("desk tool-result: %d %s", resp.StatusCode, truncate(string(b), 300))
	}
	return nil
}
