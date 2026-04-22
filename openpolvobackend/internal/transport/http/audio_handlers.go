package httptransport

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"
)

type AudioHandlers struct {
	OpenAIAPIKey          string
	GoogleAPIKey          string
	OpenAITranscribeModel string
	GeminiTranscribeModel string
}

func (h *AudioHandlers) PostTranscribe(w http.ResponseWriter, r *http.Request) {
	_, _, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "não autenticado")
		return
	}

	if err := r.ParseMultipartForm(25 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "multipart inválido")
		return
	}

	f, hdr, err := r.FormFile("audio")
	if err != nil {
		writeError(w, http.StatusBadRequest, "campo 'audio' obrigatório")
		return
	}
	defer f.Close()

	audioBytes, err := io.ReadAll(io.LimitReader(f, 25<<20))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "erro a ler ficheiro de áudio")
		return
	}

	provider := strings.ToLower(strings.TrimSpace(r.FormValue("model_provider")))
	if provider == "" {
		provider = "openai"
	}

	geminiModel := strings.TrimSpace(h.GeminiTranscribeModel)
	if geminiModel == "" {
		geminiModel = "gemini-2.5-flash"
	}
	openAIModel := strings.TrimSpace(h.OpenAITranscribeModel)
	if openAIModel == "" {
		openAIModel = "whisper-1"
	}

	var text string
	switch provider {
	case "google":
		text, err = transcribeGemini(r.Context(), h.GoogleAPIKey, geminiModel, audioBytes, hdr.Filename)
	default:
		text, err = transcribeWhisper(r.Context(), h.OpenAIAPIKey, openAIModel, audioBytes, hdr.Filename)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"text": text})
}

func transcribeWhisper(ctx context.Context, apiKey string, model string, data []byte, filename string) (string, error) {
	if apiKey == "" {
		return "", fmt.Errorf("OPENAI_API_KEY não configurado")
	}

	if filename == "" {
		filename = "recording.webm"
	}

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile("file", filename)
	if err != nil {
		return "", err
	}
	if _, err = fw.Write(data); err != nil {
		return "", err
	}
	_ = mw.WriteField("model", model)
	_ = mw.WriteField("language", "pt")
	mw.Close()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.openai.com/v1/audio/transcriptions", &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", mw.FormDataContentType())

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("whisper: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("whisper erro %d: %s", resp.StatusCode, truncateForClientErr(string(raw), 200))
	}

	var result struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return "", fmt.Errorf("whisper resposta inválida: %w", err)
	}
	return strings.TrimSpace(result.Text), nil
}

func transcribeGemini(ctx context.Context, apiKey string, model string, data []byte, filename string) (string, error) {
	if apiKey == "" {
		return "", fmt.Errorf("GOOGLE_API_KEY não configurado")
	}

	mimeType := "audio/webm"
	lower := strings.ToLower(filename)
	switch {
	case strings.HasSuffix(lower, ".mp4"):
		mimeType = "audio/mp4"
	case strings.HasSuffix(lower, ".wav"):
		mimeType = "audio/wav"
	case strings.HasSuffix(lower, ".ogg"):
		mimeType = "audio/ogg"
	case strings.HasSuffix(lower, ".m4a"):
		mimeType = "audio/mp4"
	}

	payload := map[string]any{
		"contents": []map[string]any{
			{
				"parts": []map[string]any{
					{
						"inline_data": map[string]string{
							"mime_type": mimeType,
							"data":      base64.StdEncoding.EncodeToString(data),
						},
					},
					{"text": "Transcreve em português o que foi dito neste áudio, com pontuação natural e fidelidade ao conteúdo (incluindo nomes próprios quando audíveis). Apenas o texto transcrito, sem prefácio nem comentários."},
				},
			},
		},
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	if strings.Contains(model, "/") || strings.Contains(model, "?") {
		return "", fmt.Errorf("modelo Gemini de transcrição inválido")
	}
	url := fmt.Sprintf(
		"https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s",
		model,
		apiKey,
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("gemini: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("gemini erro %d: %s", resp.StatusCode, truncateForClientErr(string(raw), 200))
	}

	var result struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return "", fmt.Errorf("gemini resposta inválida: %w", err)
	}
	if len(result.Candidates) == 0 || len(result.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("gemini: sem transcrição na resposta")
	}
	return strings.TrimSpace(result.Candidates[0].Content.Parts[0].Text), nil
}
