package application

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/social/domain"
	"github.com/open-polvo/open-polvo/internal/social/ports"
)

// GeneratePostResult resposta da geração de conteúdo pelo serviço Python.
type GeneratePostResult struct {
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Hashtags    []string `json:"hashtags"`
	ImageURL    string   `json:"image_url"`
	ImagePrompt string   `json:"image_prompt"`
	SourceURL   string   `json:"source_url"`
	SourceTitle string   `json:"source_title"`
}

// GenerateAndStore gera um post via Python Intelligence e guarda na BD.
type GenerateAndStore struct {
	Posts            ports.SocialPostRepository
	IntelligenceURL  string
	IntelligenceKey  string
	HTTPTimeout      time.Duration
}

type GenerateInput struct {
	UserID   uuid.UUID
	ConfigID string
	Platform string // "facebook" | "instagram"
	Sites    []string
	Provider string // "openai" | "google"
}

func (uc *GenerateAndStore) Execute(ctx context.Context, in GenerateInput) (*domain.SocialPost, error) {
	if uc.IntelligenceURL == "" {
		return nil, fmt.Errorf("Open Polvo Intelligence não configurado")
	}
	timeout := uc.HTTPTimeout
	if timeout <= 0 {
		timeout = 120 * time.Second
	}
	client := &http.Client{Timeout: timeout}

	body, err := json.Marshal(map[string]any{
		"sites":          in.Sites,
		"platform":       in.Platform,
		"model_provider": in.Provider,
		"generate_image": true,
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimRight(uc.IntelligenceURL, "/")+"/v1/social/generate-post",
		bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Open-Polvo-Internal-Key", uc.IntelligenceKey)

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("falha ao contactar Intelligence: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Intelligence %d: %s", resp.StatusCode, truncate(string(raw), 300))
	}
	var result GeneratePostResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("decode generate-post: %w", err)
	}
	if strings.TrimSpace(result.Description) == "" {
		return nil, fmt.Errorf("conteúdo gerado vazio")
	}

	post := &domain.SocialPost{
		ID:          uuid.NewString(),
		UserID:      in.UserID.String(),
		ConfigID:    in.ConfigID,
		Platform:    in.Platform,
		Title:       result.Title,
		Description: result.Description,
		Hashtags:    result.Hashtags,
		ImageURL:    result.ImageURL,
		ImagePrompt: result.ImagePrompt,
		SourceURL:   result.SourceURL,
		SourceTitle: result.SourceTitle,
		Status:      domain.StatusPendingApproval,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	if err := uc.Posts.Create(ctx, post); err != nil {
		return nil, err
	}
	return post, nil
}

func truncate(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
