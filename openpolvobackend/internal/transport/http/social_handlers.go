package httptransport

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	socialapp "github.com/open-polvo/open-polvo/internal/social/application"
)

type SocialHandlers struct {
	GetConfig  *socialapp.GetSocialConfig
	PutConfig  *socialapp.PutSocialConfig
	Generate   *socialapp.GenerateAndStore
	Approval   *socialapp.SendApprovalWhatsApp
	Publisher  *socialapp.PublishPost
	ListPosts  *socialapp.ListSocialPosts
}

func (h *SocialHandlers) GetSocialConfig(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	dto, err := h.GetConfig.Execute(r.Context(), uid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "falha ao carregar configuração social")
		return
	}
	writeJSON(w, http.StatusOK, dto)
}

type putSocialConfigBody struct {
	Platforms     []string `json:"platforms"`
	Sites         []string `json:"sites"`
	TimesPerDay   int      `json:"times_per_day"`
	ApprovalPhone string   `json:"approval_phone"`
	Active        bool     `json:"active"`
}

func (h *SocialHandlers) PutSocialConfig(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	var body putSocialConfigBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "json inválido")
		return
	}
	err := h.PutConfig.Execute(r.Context(), uid, socialapp.PutSocialConfigInput{
		Platforms:     body.Platforms,
		Sites:         body.Sites,
		TimesPerDay:   body.TimesPerDay,
		ApprovalPhone: body.ApprovalPhone,
		Active:        body.Active,
	})
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "inválid") || strings.Contains(msg, "obrigatório") {
			writeError(w, http.StatusBadRequest, msg)
			return
		}
		writeError(w, http.StatusInternalServerError, "falha ao guardar configuração social")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

type postGenerateBody struct {
	Platform string `json:"platform"`
}

func (h *SocialHandlers) PostGenerateNow(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	var body postGenerateBody
	_ = json.NewDecoder(r.Body).Decode(&body)
	platform := strings.TrimSpace(body.Platform)
	if platform == "" {
		platform = "facebook"
	}

	cfg, err := h.GetConfig.Execute(r.Context(), uid)
	if err != nil || len(cfg.Sites) == 0 {
		writeError(w, http.StatusBadRequest, "configure pelo menos um site de referência")
		return
	}

	post, err := h.Generate.Execute(r.Context(), socialapp.GenerateInput{
		UserID:   uid,
		ConfigID: cfg.ID,
		Platform: platform,
		Sites:    cfg.Sites,
		Provider: "openai",
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, "falha ao gerar post: "+truncateForClientErr(err.Error(), 300))
		return
	}

	// Envia WhatsApp de aprovação se phone configurado.
	if cfg.ApprovalPhone != "" && h.Approval != nil {
		_ = h.Approval.Execute(r.Context(), uid, post, cfg.ApprovalPhone)
	}

	dto := socialapp.SocialPostDTO{
		ID:          post.ID,
		Platform:    post.Platform,
		Title:       post.Title,
		Description: post.Description,
		Hashtags:    post.Hashtags,
		ImageURL:    post.ImageURL,
		SourceURL:   post.SourceURL,
		SourceTitle: post.SourceTitle,
		Status:      string(post.Status),
		CreatedAtISO: post.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z07:00"),
	}
	if dto.Hashtags == nil {
		dto.Hashtags = []string{}
	}
	writeJSON(w, http.StatusCreated, dto)
}

func (h *SocialHandlers) PostApprovePost(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	postID := chi.URLParam(r, "id")
	if err := h.Publisher.ApprovePost(r.Context(), uid, postID); err != nil {
		msg := err.Error()
		if strings.Contains(msg, "não encontrado") || strings.Contains(msg, "não está") {
			writeError(w, http.StatusBadRequest, msg)
			return
		}
		writeError(w, http.StatusBadGateway, "falha ao publicar: "+truncateForClientErr(msg, 300))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "published"})
}

func (h *SocialHandlers) PostRejectPost(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	postID := chi.URLParam(r, "id")
	if err := h.Publisher.RejectPost(r.Context(), uid, postID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "rejected"})
}

func (h *SocialHandlers) GetSocialPosts(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	limit := 50
	if q := r.URL.Query().Get("limit"); q != "" {
		if n, err := strconv.Atoi(q); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	posts, err := h.ListPosts.Execute(r.Context(), uid, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "falha ao listar posts")
		return
	}
	if posts == nil {
		posts = []socialapp.SocialPostDTO{}
	}
	writeJSON(w, http.StatusOK, posts)
}
