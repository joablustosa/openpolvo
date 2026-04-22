package metaapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const graphBase = "https://graph.facebook.com/v21.0"

// Client faz chamadas à Meta Graph API v21.0.
type Client struct {
	http *http.Client
}

func New() *Client {
	return &Client{
		http: &http.Client{Timeout: 30 * time.Second},
	}
}

// PostFacebookPage publica uma mensagem de texto na página do Facebook.
func (c *Client) PostFacebookPage(ctx context.Context, pageID, pageToken, message string) (string, error) {
	body, _ := json.Marshal(map[string]string{
		"message":      message,
		"access_token": pageToken,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/%s/feed", graphBase, pageID), bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	return c.doPostID(req)
}

// PostInstagramText publica legenda de texto no feed do Instagram Business (post de imagem obrigatório).
// imageURL deve ser uma URL pública acessível pela Meta.
func (c *Client) PostInstagramMedia(ctx context.Context, igAccountID, accessToken, imageURL, caption string) (string, error) {
	// Passo 1: criar container de media.
	body, _ := json.Marshal(map[string]string{
		"image_url":    imageURL,
		"caption":      caption,
		"access_token": accessToken,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/%s/media", graphBase, igAccountID), bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	containerID, err := c.doPostID(req)
	if err != nil {
		return "", fmt.Errorf("criar media container: %w", err)
	}

	// Passo 2: publicar.
	pub, _ := json.Marshal(map[string]string{
		"creation_id":  containerID,
		"access_token": accessToken,
	})
	req2, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/%s/media_publish", graphBase, igAccountID), bytes.NewReader(pub))
	if err != nil {
		return "", err
	}
	req2.Header.Set("Content-Type", "application/json")
	return c.doPostID(req2)
}

// PostInstagramTextOnly publica apenas texto como comentário/storia se não houver imagem.
// Na prática a Graph API exige imagem; esta função envia um post no Facebook para a conta ligada.
// Use PostInstagramMedia para posts reais.
func (c *Client) PostInstagramCaption(ctx context.Context, igAccountID, accessToken, caption string) (string, error) {
	// Instagram Threads ou Reels text-only; fallback: envia como feed post sem media (API v21 suporta apenas com imagem/video).
	// Para compatibilidade real recomenda-se sempre fornecer imageURL.
	body, _ := json.Marshal(map[string]string{
		"media_type":   "REELS",
		"video_url":    "",
		"caption":      caption,
		"access_token": accessToken,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/%s/media", graphBase, igAccountID), bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	return c.doPostID(req)
}

// SendWhatsAppText envia mensagem de texto via WhatsApp Business Cloud API.
func (c *Client) SendWhatsAppText(ctx context.Context, phoneNumberID, accessToken, to, text string) (string, error) {
	body, _ := json.Marshal(map[string]any{
		"messaging_product": "whatsapp",
		"recipient_type":    "individual",
		"to":                to,
		"type":              "text",
		"text":              map[string]string{"body": text},
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/%s/messages", graphBase, phoneNumberID), bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+accessToken)
	return c.doPostID(req)
}

// VerifyTokenTest chama GET /me para validar um token genérico (page ou user).
func (c *Client) VerifyToken(ctx context.Context, accessToken string) error {
	u, _ := url.Parse(graphBase + "/me")
	q := u.Query()
	q.Set("access_token", accessToken)
	q.Set("fields", "id,name")
	u.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("meta verify token: %d: %s", resp.StatusCode, truncate(string(b), 300))
	}
	return nil
}

func (c *Client) doPostID(req *http.Request) (string, error) {
	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("meta graph api: %d: %s", resp.StatusCode, truncate(string(b), 400))
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(b, &out); err != nil {
		return "", fmt.Errorf("meta decode: %w (body: %s)", err, truncate(string(b), 200))
	}
	return out.ID, nil
}

func truncate(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
