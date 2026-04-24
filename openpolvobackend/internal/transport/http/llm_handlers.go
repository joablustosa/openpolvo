package httptransport

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/llmprofiles/ports"
)

type LLMHandlers struct {
	Repo ports.Repository
}

type llmProfileDTO struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	Provider    string `json:"provider"`
	ModelID     string `json:"model_id"`
	SortOrder   int    `json:"sort_order"`
	HasAPIKey   bool   `json:"has_api_key"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

type postLLMProfileRequest struct {
	DisplayName string `json:"display_name"`
	Provider    string `json:"provider"`
	ModelID     string `json:"model_id"`
	APIKey      string `json:"api_key"`
	SortOrder   *int   `json:"sort_order,omitempty"`
}

type patchLLMProfileRequest struct {
	DisplayName *string `json:"display_name,omitempty"`
	ModelID     *string `json:"model_id,omitempty"`
	APIKey      *string `json:"api_key,omitempty"`
	SortOrder   *int    `json:"sort_order,omitempty"`
}

type llmAgentPrefsDTO struct {
	AgentMode         string  `json:"agent_mode"`
	DefaultProfileID  *string `json:"default_profile_id,omitempty"`
	UpdatedAt         string  `json:"updated_at"`
}

type putLLMAgentPrefsRequest struct {
	AgentMode        string  `json:"agent_mode"`
	DefaultProfileID *string `json:"default_profile_id,omitempty"`
}

func (h *LLMHandlers) ListProfiles(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.Repo == nil {
		writeError(w, http.StatusNotImplemented, "llm profiles not configured")
		return
	}
	list, err := h.Repo.ListProfiles(r.Context())
	if err != nil {
		slog.Error("llm list profiles", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to list profiles")
		return
	}
	out := make([]llmProfileDTO, 0, len(list))
	for _, p := range list {
		out = append(out, llmProfileDTO{
			ID:          p.ID.String(),
			DisplayName: p.DisplayName,
			Provider:    p.Provider,
			ModelID:     p.ModelID,
			SortOrder:   p.SortOrder,
			HasAPIKey:   p.HasKeyCipher,
			CreatedAt:   formatTimeUTC(p.CreatedAt),
			UpdatedAt:   formatTimeUTC(p.UpdatedAt),
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *LLMHandlers) PostProfile(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.Repo == nil {
		writeError(w, http.StatusNotImplemented, "llm profiles not configured")
		return
	}
	var req postLLMProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Provider = strings.ToLower(strings.TrimSpace(req.Provider))
	if req.Provider != "openai" && req.Provider != "google" {
		writeError(w, http.StatusBadRequest, "provider must be openai or google")
		return
	}
	if strings.TrimSpace(req.DisplayName) == "" || strings.TrimSpace(req.ModelID) == "" || strings.TrimSpace(req.APIKey) == "" {
		writeError(w, http.StatusBadRequest, "display_name, model_id and api_key are required")
		return
	}
	sort := 0
	if req.SortOrder != nil {
		sort = *req.SortOrder
	}
	id, err := h.Repo.CreateProfile(r.Context(), req.DisplayName, req.Provider, req.ModelID, sort, req.APIKey)
	if err != nil {
		slog.Error("llm create profile", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to create profile")
		return
	}
	p, err := h.Repo.GetProfileByID(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusCreated, llmProfileDTO{ID: id.String()})
		return
	}
	writeJSON(w, http.StatusCreated, llmProfileDTO{
		ID: p.ID.String(), DisplayName: p.DisplayName, Provider: p.Provider, ModelID: p.ModelID,
		SortOrder: p.SortOrder, HasAPIKey: p.HasKeyCipher, CreatedAt: formatTimeUTC(p.CreatedAt), UpdatedAt: formatTimeUTC(p.UpdatedAt),
	})
}

func (h *LLMHandlers) PatchProfile(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.Repo == nil {
		writeError(w, http.StatusNotImplemented, "llm profiles not configured")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid profile id")
		return
	}
	var req patchLLMProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if err := h.Repo.UpdateProfile(r.Context(), id, req.DisplayName, req.ModelID, req.SortOrder, req.APIKey); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "profile not found")
			return
		}
		slog.Error("llm patch profile", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to update profile")
		return
	}
	p, err := h.Repo.GetProfileByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "profile not found")
		return
	}
	writeJSON(w, http.StatusOK, llmProfileDTO{
		ID: p.ID.String(), DisplayName: p.DisplayName, Provider: p.Provider, ModelID: p.ModelID,
		SortOrder: p.SortOrder, HasAPIKey: p.HasKeyCipher, CreatedAt: formatTimeUTC(p.CreatedAt), UpdatedAt: formatTimeUTC(p.UpdatedAt),
	})
}

func (h *LLMHandlers) DeleteProfile(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.Repo == nil {
		writeError(w, http.StatusNotImplemented, "llm profiles not configured")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid profile id")
		return
	}
	if err := h.Repo.DeleteProfile(r.Context(), id); err != nil {
		slog.Error("llm delete profile", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to delete profile")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *LLMHandlers) GetAgentPrefs(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.Repo == nil {
		writeError(w, http.StatusNotImplemented, "llm profiles not configured")
		return
	}
	p, err := h.Repo.GetAgentPrefs(r.Context())
	if err != nil {
		slog.Error("llm get prefs", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to load prefs")
		return
	}
	var def *string
	if p.DefaultProfileID != nil {
		s := p.DefaultProfileID.String()
		def = &s
	}
	writeJSON(w, http.StatusOK, llmAgentPrefsDTO{
		AgentMode:        p.AgentMode,
		DefaultProfileID: def,
		UpdatedAt:        formatTimeUTC(p.UpdatedAt),
	})
}

func (h *LLMHandlers) PutAgentPrefs(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.Repo == nil {
		writeError(w, http.StatusNotImplemented, "llm profiles not configured")
		return
	}
	var req putLLMAgentPrefsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	mode := strings.ToLower(strings.TrimSpace(req.AgentMode))
	if mode != "auto" && mode != "profile" {
		writeError(w, http.StatusBadRequest, "agent_mode must be auto or profile")
		return
	}
	var def *uuid.UUID
	if req.DefaultProfileID != nil && strings.TrimSpace(*req.DefaultProfileID) != "" {
		u, err := uuid.Parse(strings.TrimSpace(*req.DefaultProfileID))
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid default_profile_id")
			return
		}
		if _, err := h.Repo.GetProfileByID(r.Context(), u); err != nil {
			writeError(w, http.StatusBadRequest, "default_profile_id not found")
			return
		}
		def = &u
	}
	if mode == "profile" && def == nil {
		writeError(w, http.StatusBadRequest, "default_profile_id required when agent_mode is profile")
		return
	}
	if err := h.Repo.SetAgentPrefs(r.Context(), mode, def); err != nil {
		slog.Error("llm put prefs", "err", err)
		writeError(w, http.StatusInternalServerError, "failed to save prefs")
		return
	}
	p, err := h.Repo.GetAgentPrefs(r.Context())
	if err != nil {
		writeJSON(w, http.StatusOK, llmAgentPrefsDTO{AgentMode: mode})
		return
	}
	var defOut *string
	if p.DefaultProfileID != nil {
		s := p.DefaultProfileID.String()
		defOut = &s
	}
	writeJSON(w, http.StatusOK, llmAgentPrefsDTO{
		AgentMode:        p.AgentMode,
		DefaultProfileID: defOut,
		UpdatedAt:        formatTimeUTC(p.UpdatedAt),
	})
}
