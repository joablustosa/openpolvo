package httptransport

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/conversations/application"
	"github.com/open-polvo/open-polvo/internal/conversations/domain"
	convports "github.com/open-polvo/open-polvo/internal/conversations/ports"
)

func truncateForClientErr(s string, maxRunes int) string {
	if maxRunes <= 0 || utf8.RuneCountInString(s) <= maxRunes {
		return s
	}
	runes := []rune(s)
	if len(runes) > maxRunes {
		return string(runes[:maxRunes]) + "…"
	}
	return s
}

type ConversationHandlers struct {
	CreateConversation *application.CreateConversation
	ListConversations  *application.ListConversations
	GetConversationUC  *application.GetConversation
	ListMessages       *application.ListMessages
	SendMessage        *application.SendMessage
	StreamMsg          *application.StreamMessage
	DeleteConversation *application.DeleteConversation
	PinConversation    *application.PinConversation
	RenameConversation *application.RenameConversation
}

func formatTimeUTC(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z07:00")
}

type conversationDTO struct {
	ID                   string  `json:"id"`
	Title                *string `json:"title,omitempty"`
	DefaultModelProvider string  `json:"default_model_provider"`
	PinnedAt             *string `json:"pinned_at,omitempty"`
	CreatedAt            string  `json:"created_at"`
	UpdatedAt            string  `json:"updated_at"`
}

type messageDTO struct {
	ID        string          `json:"id"`
	Role      string          `json:"role"`
	Content   string          `json:"content"`
	Metadata  json.RawMessage `json:"metadata,omitempty"`
	CreatedAt string          `json:"created_at"`
}

func toConversationDTO(c domain.Conversation) conversationDTO {
	dto := conversationDTO{
		ID:                   c.ID.String(),
		Title:                c.Title,
		DefaultModelProvider: string(c.DefaultModel),
		CreatedAt:            formatTimeUTC(c.CreatedAt),
		UpdatedAt:            formatTimeUTC(c.UpdatedAt),
	}
	if c.PinnedAt != nil {
		s := formatTimeUTC(*c.PinnedAt)
		dto.PinnedAt = &s
	}
	return dto
}

type createConversationRequest struct {
	Title                *string `json:"title"`
	DefaultModelProvider string  `json:"default_model_provider,omitempty"`
}

type patchConversationRequest struct {
	Title *string `json:"title"`
}

type pinConversationRequest struct {
	Pinned bool `json:"pinned"`
}

type postMessageRequest struct {
	Text          string `json:"text"`
	ModelProvider string `json:"model_provider,omitempty"`
}

func (h *ConversationHandlers) GetConversations(w http.ResponseWriter, r *http.Request) {
	uidStr, _, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	uid, err := uuid.Parse(uidStr)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid user")
		return
	}
	list, err := h.ListConversations.Execute(r.Context(), uid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list conversations")
		return
	}
	out := make([]conversationDTO, 0, len(list))
	for _, c := range list {
		out = append(out, toConversationDTO(c))
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *ConversationHandlers) PostConversation(w http.ResponseWriter, r *http.Request) {
	uidStr, _, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	uid, err := uuid.Parse(uidStr)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid user")
		return
	}
	var req createConversationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	mp := domain.ModelOpenAI
	if req.DefaultModelProvider != "" {
		var ok bool
		mp, ok = domain.ParseModelProvider(req.DefaultModelProvider)
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid default_model_provider")
			return
		}
	}
	c, err := h.CreateConversation.Execute(r.Context(), application.CreateConversationCommand{
		UserID:       uid,
		Title:        req.Title,
		DefaultModel: mp,
	})
	if err != nil {
		slog.Error("create conversation", "err", err)
		writeError(
			w,
			http.StatusBadGateway,
			"failed to create conversation: "+truncateForClientErr(err.Error(), 380),
		)
		return
	}
	writeJSON(w, http.StatusCreated, toConversationDTO(*c))
}

func (h *ConversationHandlers) GetConversation(w http.ResponseWriter, r *http.Request) {
	uidStr, _, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	uid, err := uuid.Parse(uidStr)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid user")
		return
	}
	cid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid conversation id")
		return
	}
	c, err := h.GetConversationUC.Execute(r.Context(), cid, uid)
	if err != nil {
		if errors.Is(err, convports.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load conversation")
		return
	}
	writeJSON(w, http.StatusOK, toConversationDTO(*c))
}

func (h *ConversationHandlers) GetMessages(w http.ResponseWriter, r *http.Request) {
	uidStr, _, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	uid, err := uuid.Parse(uidStr)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid user")
		return
	}
	cid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid conversation id")
		return
	}
	msgs, err := h.ListMessages.Execute(r.Context(), cid, uid)
	if err != nil {
		if errors.Is(err, convports.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to list messages")
		return
	}
	out := make([]messageDTO, 0, len(msgs))
	for _, m := range msgs {
		dto := messageDTO{
			ID:        m.ID.String(),
			Role:      m.Role,
			Content:   m.Content,
			CreatedAt: formatTimeUTC(m.CreatedAt),
		}
		if len(m.Metadata) > 0 && json.Valid(m.Metadata) {
			dto.Metadata = m.Metadata
		}
		out = append(out, dto)
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *ConversationHandlers) PostMessage(w http.ResponseWriter, r *http.Request) {
	uidStr, _, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	uid, err := uuid.Parse(uidStr)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid user")
		return
	}
	cid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid conversation id")
		return
	}
	var req postMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	var mp domain.ModelProvider
	if req.ModelProvider != "" {
		var ok bool
		mp, ok = domain.ParseModelProvider(req.ModelProvider)
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid model_provider")
			return
		}
	}
	msgs, err := h.SendMessage.Execute(r.Context(), application.SendMessageCommand{
		UserID:         uid,
		ConversationID: cid,
		Text:           req.Text,
		ModelProvider:  mp,
	})
	if err != nil {
		switch {
		case errors.Is(err, convports.ErrNotFound):
			writeError(w, http.StatusNotFound, "not found")
			return
		case errors.Is(err, convports.ErrEmptyMessage):
			writeError(w, http.StatusBadRequest, "text is required")
			return
		case errors.Is(err, convports.ErrAgentDisabled):
			writeError(w, http.StatusServiceUnavailable, "agent not configured: set POLVO_INTELLIGENCE_BASE_URL and POLVO_INTELLIGENCE_INTERNAL_KEY and run Open Polvo Intelligence")
			return
		case errors.Is(err, convports.ErrModelNotConfigured):
			writeError(w, http.StatusServiceUnavailable, "no API key for the selected model provider")
			return
		}
		slog.Error("send message", "err", err)
		writeError(
			w,
			http.StatusBadGateway,
			"failed to send message: "+truncateForClientErr(err.Error(), 380),
		)
		return
	}
	out := make([]messageDTO, 0, len(msgs))
	for _, m := range msgs {
		dto := messageDTO{
			ID:        m.ID.String(),
			Role:      m.Role,
			Content:   m.Content,
			CreatedAt: formatTimeUTC(m.CreatedAt),
		}
		if len(m.Metadata) > 0 && json.Valid(m.Metadata) {
			dto.Metadata = m.Metadata
		}
		out = append(out, dto)
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *ConversationHandlers) DeleteConversationHandler(w http.ResponseWriter, r *http.Request) {
	uidStr, _, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	uid, err := uuid.Parse(uidStr)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid user")
		return
	}
	cid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid conversation id")
		return
	}
	if err := h.DeleteConversation.Execute(r.Context(), cid, uid); err != nil {
		if errors.Is(err, convports.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to delete conversation")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *ConversationHandlers) PatchConversationHandler(w http.ResponseWriter, r *http.Request) {
	uidStr, _, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	uid, err := uuid.Parse(uidStr)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid user")
		return
	}
	cid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid conversation id")
		return
	}
	var req patchConversationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Title == nil {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	if err := h.RenameConversation.Execute(r.Context(), cid, uid, *req.Title); err != nil {
		switch {
		case errors.Is(err, convports.ErrNotFound):
			writeError(w, http.StatusNotFound, "not found")
			return
		case errors.Is(err, convports.ErrEmptyTitle):
			writeError(w, http.StatusBadRequest, "title cannot be empty")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to rename conversation")
		return
	}
	c, err := h.GetConversationUC.Execute(r.Context(), cid, uid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to fetch updated conversation")
		return
	}
	writeJSON(w, http.StatusOK, toConversationDTO(*c))
}

// StreamMessage aceita POST /v1/conversations/{id}/messages/stream e responde
// com text/event-stream (SSE). Elimina o timeout HTTP do Builder Lovable-like
// ao fazer proxy linha a linha do stream Python para o browser.
func (h *ConversationHandlers) StreamMessage(w http.ResponseWriter, r *http.Request) {
	uidStr, _, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	uid, err := uuid.Parse(uidStr)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid user")
		return
	}
	cid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid conversation id")
		return
	}
	if h.StreamMsg == nil {
		writeError(w, http.StatusServiceUnavailable, "agent not configured: set POLVO_INTELLIGENCE_BASE_URL and POLVO_INTELLIGENCE_INTERNAL_KEY")
		return
	}
	var req postMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	var mp domain.ModelProvider
	if req.ModelProvider != "" {
		var ok bool
		mp, ok = domain.ParseModelProvider(req.ModelProvider)
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid model_provider")
			return
		}
	}

	// Prepara: guarda mensagem do utilizador, abre stream Python.
	result, err := h.StreamMsg.Prepare(r.Context(), application.StreamMessageCommand{
		UserID:         uid,
		ConversationID: cid,
		Text:           req.Text,
		ModelProvider:  mp,
	})
	if err != nil {
		switch {
		case errors.Is(err, convports.ErrNotFound):
			writeError(w, http.StatusNotFound, "not found")
		case errors.Is(err, convports.ErrEmptyMessage):
			writeError(w, http.StatusBadRequest, "text is required")
		case errors.Is(err, convports.ErrAgentDisabled):
			writeError(w, http.StatusServiceUnavailable, "agent not configured")
		default:
			slog.Error("stream message prepare", "err", err)
			writeError(w, http.StatusBadGateway, "failed: "+truncateForClientErr(err.Error(), 300))
		}
		return
	}
	defer result.Cleanup()

	// Cabeçalhos SSE.
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	flusher, canFlush := w.(http.Flusher)

	sendLine := func(line string) {
		fmt.Fprintf(w, "%s\n\n", line)
		if canFlush {
			flusher.Flush()
		}
	}

	// Proxy linha a linha do stream Python.
	var assistantText string
	var assistantMeta map[string]any
	scanner := result.Scanner
	scanner.Buffer(make([]byte, 1024*1024), 4*1024*1024) // até 4 MB por linha (ficheiros grandes)

	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		// Reencaminha o evento para o browser.
		sendLine(line)

		// Verifica se é o evento "done" para guardar na BD depois.
		payload := strings.TrimPrefix(line, "data: ")
		var evt application.StreamEvent
		if json.Unmarshal([]byte(payload), &evt) == nil {
			if evt.Type == "done" {
				assistantText = evt.AssistantText
				assistantMeta = evt.Metadata
			}
		}

		// Termina se o cliente desligou.
		select {
		case <-r.Context().Done():
			return
		default:
		}
	}

	// Guarda a resposta do assistente na BD.
	if assistantText != "" || assistantMeta != nil {
		msgs, saveErr := h.StreamMsg.SaveAssistant(
			r.Context(),
			result.Conv,
			assistantText,
			assistantMeta,
			uid,
			req.Text,
		)
		if saveErr == nil {
			out := make([]messageDTO, 0, len(msgs))
			for _, m := range msgs {
				dto := messageDTO{
					ID:        m.ID.String(),
					Role:      m.Role,
					Content:   m.Content,
					CreatedAt: formatTimeUTC(m.CreatedAt),
				}
				if len(m.Metadata) > 0 && json.Valid(m.Metadata) {
					dto.Metadata = m.Metadata
				}
				out = append(out, dto)
			}
			if b, err := json.Marshal(map[string]any{"type": "messages_saved", "messages": out}); err == nil {
				sendLine("data: " + string(b))
			}
		}
	} else {
		// Stream terminou sem evento "done" — erro no Python.
		h.StreamMsg.SaveAssistantError(r.Context(), result.Conv, "stream terminou sem resposta")
		sendLine(`data: {"type":"error","detail":"stream terminou sem resposta"}`)
	}
}

func (h *ConversationHandlers) PinConversationHandler(w http.ResponseWriter, r *http.Request) {
	uidStr, _, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	uid, err := uuid.Parse(uidStr)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid user")
		return
	}
	cid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid conversation id")
		return
	}
	var req pinConversationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if err := h.PinConversation.Execute(r.Context(), cid, uid, req.Pinned); err != nil {
		if errors.Is(err, convports.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to pin conversation")
		return
	}
	c, err := h.GetConversationUC.Execute(r.Context(), cid, uid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to fetch updated conversation")
		return
	}
	writeJSON(w, http.StatusOK, toConversationDTO(*c))
}
