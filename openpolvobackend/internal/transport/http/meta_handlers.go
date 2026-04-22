package httptransport

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"

	metaapp "github.com/open-polvo/open-polvo/internal/meta/application"
	"github.com/open-polvo/open-polvo/internal/meta/metaapi"
	socialapp "github.com/open-polvo/open-polvo/internal/social/application"
	socialports "github.com/open-polvo/open-polvo/internal/social/ports"
)

type MetaHandlers struct {
	GetMeta     *metaapp.GetMyMeta
	PutMeta     *metaapp.PutMyMeta
	TestMeta    *metaapp.TestMetaConnection
	PostContent *metaapp.PostMetaContent
	SendMessage *metaapp.SendMetaMessage
	// WebhookVerifyToken token configurado em META_WEBHOOK_VERIFY_TOKEN (validação do hub.challenge).
	WebhookVerifyToken string
	// AppSecretForWebhook para validar assinatura X-Hub-Signature-256.
	AppSecretForWebhook string
	// SocialReplyHandler processa respostas WhatsApp de aprovação de posts sociais.
	SocialReplyHandler *socialapp.HandleWhatsAppReply
	// SocialConfigRepo para resolver o userID a partir do phone number.
	SocialConfigRepo socialports.AutomationConfigRepository
}

func (h *MetaHandlers) GetMeMeta(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	dto, err := h.GetMeta.Execute(r.Context(), uid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "falha ao carregar configurações Meta")
		return
	}
	writeJSON(w, http.StatusOK, dto)
}

type putMetaBody struct {
	AppID              string `json:"app_id"`
	AppSecret          string `json:"app_secret"`
	WAPhoneNumberID    string `json:"wa_phone_number_id"`
	WAAccessToken      string `json:"wa_access_token"`
	FBPageID           string `json:"fb_page_id"`
	FBPageToken        string `json:"fb_page_token"`
	IGAccountID        string `json:"ig_account_id"`
	IGAccessToken      string `json:"ig_access_token"`
	WebhookVerifyToken string `json:"webhook_verify_token"`
}

func (h *MetaHandlers) PutMeMeta(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	var body putMetaBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "json inválido")
		return
	}
	err := h.PutMeta.Execute(r.Context(), uid, metaapp.PutMyMetaInput{
		AppID:              body.AppID,
		AppSecret:          body.AppSecret,
		WAPhoneNumberID:    body.WAPhoneNumberID,
		WAAccessToken:      body.WAAccessToken,
		FBPageID:           body.FBPageID,
		FBPageToken:        body.FBPageToken,
		IGAccountID:        body.IGAccountID,
		IGAccessToken:      body.IGAccessToken,
		WebhookVerifyToken: body.WebhookVerifyToken,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "falha ao guardar configurações Meta")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *MetaHandlers) PostTestMeta(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	if err := h.TestMeta.Execute(r.Context(), uid); err != nil {
		msg := err.Error()
		if strings.Contains(msg, "não configurado") {
			writeError(w, http.StatusBadRequest, msg)
			return
		}
		writeError(w, http.StatusServiceUnavailable, "meta test failed: "+truncateForClientErr(msg, 400))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

type postMetaContentBody struct {
	Platform string `json:"platform"`
	Message  string `json:"message"`
	ImageURL string `json:"image_url,omitempty"`
}

func (h *MetaHandlers) PostMetaContent(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	var body postMetaContentBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "json inválido")
		return
	}
	result, err := h.PostContent.Execute(r.Context(), uid, metaapp.PostMetaContentInput{
		Platform: body.Platform,
		Message:  body.Message,
		ImageURL: body.ImageURL,
	})
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "não configurad") || strings.Contains(msg, "inválid") {
			writeError(w, http.StatusBadRequest, msg)
			return
		}
		writeError(w, http.StatusBadGateway, "meta post failed: "+truncateForClientErr(msg, 400))
		return
	}
	writeJSON(w, http.StatusOK, result)
}

type postMetaSendBody struct {
	Platform string `json:"platform"`
	To       string `json:"to"`
	Text     string `json:"text"`
}

func (h *MetaHandlers) PostMetaSendMessage(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	var body postMetaSendBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "json inválido")
		return
	}
	result, err := h.SendMessage.Execute(r.Context(), uid, metaapp.SendMetaMessageInput{
		Platform: body.Platform,
		To:       body.To,
		Text:     body.Text,
	})
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "não configurad") || strings.Contains(msg, "obrigatório") || strings.Contains(msg, "inválid") {
			writeError(w, http.StatusBadRequest, msg)
			return
		}
		writeError(w, http.StatusBadGateway, "meta send failed: "+truncateForClientErr(msg, 400))
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// GetMetaWebhook processa a verificação do hub.challenge (GET).
// Esta rota é pública (sem BearerAuth) e registada no painel da Meta.
func (h *MetaHandlers) GetMetaWebhook(w http.ResponseWriter, r *http.Request) {
	mode := r.URL.Query().Get("hub.mode")
	token := r.URL.Query().Get("hub.verify_token")
	challenge := r.URL.Query().Get("hub.challenge")
	if mode == "subscribe" && token == h.WebhookVerifyToken && h.WebhookVerifyToken != "" {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(challenge))
		return
	}
	writeError(w, http.StatusForbidden, "webhook verification failed")
}

// PostMetaWebhook recebe eventos da Meta (mensagens de WhatsApp, Facebook, Instagram).
func (h *MetaHandlers) PostMetaWebhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read body")
		return
	}
	sig := r.Header.Get("X-Hub-Signature-256")
	if h.AppSecretForWebhook != "" && sig != "" {
		if !metaapi.VerifyWebhookSignature(h.AppSecretForWebhook, body, sig) {
			writeError(w, http.StatusForbidden, "invalid signature")
			return
		}
	}

	ev, parseErr := metaapi.ParseWebhookEvent(body)
	if parseErr == nil && ev != nil {
		// Processar mensagens WhatsApp para aprovação de posts.
		if h.SocialReplyHandler != nil && len(ev.WhatsApp) > 0 {
			go h.processWhatsAppApprovals(r.Context(), ev.WhatsApp)
		}
	}

	// Meta espera 200 imediato.
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("EVENT_RECEIVED"))
}

// processWhatsAppApprovals processa mensagens de aprovação em background.
func (h *MetaHandlers) processWhatsAppApprovals(ctx context.Context, msgs []metaapi.WhatsAppMessage) {
	if h.SocialReplyHandler == nil || h.SocialConfigRepo == nil {
		return
	}
	for _, msg := range msgs {
		text := strings.TrimSpace(msg.Body)
		if text == "" {
			continue
		}
		// Encontra o utilizador cujo número de aprovação coincide com o remetente.
		userID, err := h.findUserByApprovalPhone(ctx, msg.From)
		if err != nil {
			slog.Debug("webhook social: utilizador não encontrado para phone", "from", msg.From)
			continue
		}
		result, err := h.SocialReplyHandler.Execute(ctx, userID, text)
		if err != nil {
			slog.Error("webhook social: handle reply", "err", err, "user", userID)
			continue
		}
		if result.Action != "ignored" {
			slog.Info("webhook social: aprovação processada", "action", result.Action, "post", result.PostID)
		}
	}
}

// findUserByApprovalPhone procura o utilizador cujo approval_phone coincide.
func (h *MetaHandlers) findUserByApprovalPhone(ctx context.Context, phone string) (uuid.UUID, error) {
	phone = strings.TrimSpace(phone)
	if phone == "" {
		return uuid.Nil, errors.New("phone vazio")
	}
	configs, err := h.SocialConfigRepo.ListActive(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	for _, cfg := range configs {
		normalized := strings.TrimPrefix(strings.TrimSpace(cfg.ApprovalPhone), "+")
		inbound := strings.TrimPrefix(phone, "+")
		if normalized == inbound || strings.HasSuffix(inbound, normalized) || strings.HasSuffix(normalized, inbound) {
			uid, err := uuid.Parse(cfg.UserID)
			if err != nil {
				continue
			}
			return uid, nil
		}
	}
	return uuid.Nil, sql.ErrNoRows
}
