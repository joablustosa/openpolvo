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
		Messages               []msgPart                        `json:"messages"`
		ModelProvider          string                           `json:"model_provider"`
		OpenAIAPIKey           string                           `json:"openai_api_key,omitempty"`
		GoogleAPIKey           string                           `json:"google_api_key,omitempty"`
		OpenAIModel            string                           `json:"openai_model,omitempty"`
		GoogleModel            string                           `json:"google_model,omitempty"`
		ConversationID         string                           `json:"conversation_id,omitempty"`
		AgentMemory            map[string]string                `json:"agent_memory,omitempty"`
		SMTPContext            *agentports.SMTPContext          `json:"smtp_context,omitempty"`
		ContactsContext        []agentports.ContactBrief        `json:"contacts_context,omitempty"`
		TaskListsContext       []agentports.TaskListBrief       `json:"task_lists_context,omitempty"`
		FinanceContext         *agentports.FinanceContext        `json:"finance_context,omitempty"`
		MetaContext            *agentports.MetaContext           `json:"meta_context,omitempty"`
		ScheduledTasksContext  []agentports.ScheduledTaskBrief  `json:"scheduled_tasks_context,omitempty"`
	}{
		ModelProvider:          string(in.ModelProvider),
		OpenAIAPIKey:           in.OpenAIAPIKey,
		GoogleAPIKey:           in.GoogleAPIKey,
		OpenAIModel:            in.OpenAIModel,
		GoogleModel:            in.GoogleModel,
		ConversationID:         strings.TrimSpace(in.ConversationID),
		SMTPContext:            in.SMTP,
		ContactsContext:        in.Contacts,
		TaskListsContext:       in.TaskLists,
		FinanceContext:         in.Finance,
		MetaContext:            in.Meta,
		ScheduledTasksContext:  in.ScheduledTasks,
	}
	if in.AgentMemory != nil {
		body.AgentMemory = map[string]string{
			"global":  in.AgentMemory.Global,
			"builder": in.AgentMemory.Builder,
		}
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
func (c *Client) GenerateGraphJSON(ctx context.Context, provider domain.ModelProvider, ov wfports.LLMOverrides, userRequest, recordingJSON string) (string, error) {
	if !c.Configured() {
		return "", fmt.Errorf("polvointel: client not configured")
	}
	body, err := json.Marshal(map[string]string{
		"model_provider":   string(provider),
		"prompt":           userRequest,
		"recording_json":   recordingJSON,
		"openai_api_key":   ov.OpenAIAPIKey,
		"google_api_key":   ov.GoogleAPIKey,
		"openai_model":     ov.OpenAIModel,
		"google_model":     ov.GoogleModel,
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

// ReplyStream abre uma ligação SSE ao Python /v1/reply/stream e devolve o
// corpo da resposta para proxy. Usa um cliente HTTP sem timeout para suportar
// streams de longa duração (sub-grafo Builder pode levar vários minutos).
// O caller é responsável por fechar o ReadCloser devolvido.
func (c *Client) ReplyStream(ctx context.Context, in agentports.ReplyInput) (io.ReadCloser, error) {
	if !c.Configured() {
		return nil, fmt.Errorf("polvointel: client not configured")
	}
	type msgPart struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	body := struct {
		Messages               []msgPart                        `json:"messages"`
		ModelProvider          string                           `json:"model_provider"`
		OpenAIAPIKey           string                           `json:"openai_api_key,omitempty"`
		GoogleAPIKey           string                           `json:"google_api_key,omitempty"`
		OpenAIModel            string                           `json:"openai_model,omitempty"`
		GoogleModel            string                           `json:"google_model,omitempty"`
		ConversationID         string                           `json:"conversation_id,omitempty"`
		AgentMemory            map[string]string                `json:"agent_memory,omitempty"`
		SMTPContext            *agentports.SMTPContext          `json:"smtp_context,omitempty"`
		ContactsContext        []agentports.ContactBrief        `json:"contacts_context,omitempty"`
		TaskListsContext       []agentports.TaskListBrief       `json:"task_lists_context,omitempty"`
		FinanceContext         *agentports.FinanceContext        `json:"finance_context,omitempty"`
		MetaContext            *agentports.MetaContext           `json:"meta_context,omitempty"`
		ScheduledTasksContext  []agentports.ScheduledTaskBrief  `json:"scheduled_tasks_context,omitempty"`
	}{
		ModelProvider:          string(in.ModelProvider),
		OpenAIAPIKey:           in.OpenAIAPIKey,
		GoogleAPIKey:           in.GoogleAPIKey,
		OpenAIModel:            in.OpenAIModel,
		GoogleModel:            in.GoogleModel,
		ConversationID:         strings.TrimSpace(in.ConversationID),
		SMTPContext:            in.SMTP,
		ContactsContext:        in.Contacts,
		TaskListsContext:       in.TaskLists,
		FinanceContext:         in.Finance,
		MetaContext:            in.Meta,
		ScheduledTasksContext:  in.ScheduledTasks,
	}
	if in.AgentMemory != nil {
		body.AgentMemory = map[string]string{
			"global":  in.AgentMemory.Global,
			"builder": in.AgentMemory.Builder,
		}
	}
	for _, m := range in.Messages {
		body.Messages = append(body.Messages, msgPart{Role: m.Role, Content: m.Content})
	}
	raw, err := json.Marshal(body)
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
		return nil, err
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
