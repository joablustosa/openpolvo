package httptransport

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	projapp "github.com/open-polvo/open-polvo/internal/projects/application"
	projdomain "github.com/open-polvo/open-polvo/internal/projects/domain"
)

// ProjectHandlers expõe os projetos de dev vinculados às conversas.
type ProjectHandlers struct {
	GetForConversation *projapp.GetProjectForConversation
	GetWithFiles       *projapp.GetProjectWithLatestFiles
	ListVersionsUC     *projapp.ListVersions
	Rollback           *projapp.RollbackToVersion
}

type projectDTO struct {
	ID               string `json:"id"`
	ConversationID   string `json:"conversation_id"`
	Title            string `json:"title"`
	Kind             string `json:"kind"`
	Stack            string `json:"stack"`
	LatestVersionSeq int    `json:"latest_version_seq"`
	UpdatedAt        string `json:"updated_at"`
}

type projectFileDTO struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type projectVersionDTO struct {
	ID        string `json:"id"`
	Seq       int    `json:"seq"`
	Summary   string `json:"summary"`
	CreatedAt string `json:"created_at"`
}

func toProjectDTO(p projdomain.Project) projectDTO {
	return projectDTO{
		ID:               p.ID.String(),
		ConversationID:   p.ConversationID.String(),
		Title:            p.Title,
		Kind:             p.Kind,
		Stack:            p.Stack,
		LatestVersionSeq: p.LatestVersionSeq,
		UpdatedAt:        formatTimeUTC(p.UpdatedAt),
	}
}

func toProjectFileDTOs(files []projdomain.ProjectFile) []projectFileDTO {
	out := make([]projectFileDTO, 0, len(files))
	for _, f := range files {
		out = append(out, projectFileDTO{Path: f.Path, Content: f.Content})
	}
	return out
}

// GetForConversationHandler GET /v1/conversations/{id}/project -> {"project": {...}|null}
func (h *ProjectHandlers) GetForConversationHandler(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	cid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid conversation id")
		return
	}
	p, err := h.GetForConversation.Execute(r.Context(), cid, uid)
	if err != nil {
		if errors.Is(err, projapp.ErrNotFound) {
			writeJSON(w, http.StatusOK, map[string]any{"project": nil})
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load project")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"project": toProjectDTO(*p)})
}

// GetProjectHandler GET /v1/projects/{id} -> {"project": {...}, "files": [...]}
func (h *ProjectHandlers) GetProjectHandler(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	pid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid project id")
		return
	}
	p, files, err := h.GetWithFiles.Execute(r.Context(), pid, uid)
	if err != nil {
		if errors.Is(err, projapp.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load project")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"project": toProjectDTO(*p),
		"files":   toProjectFileDTOs(files),
	})
}

// ListVersionsHandler GET /v1/projects/{id}/versions -> {"versions": [...]}
func (h *ProjectHandlers) ListVersionsHandler(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	pid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid project id")
		return
	}
	versions, err := h.ListVersionsUC.Execute(r.Context(), pid, uid)
	if err != nil {
		if errors.Is(err, projapp.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to list versions")
		return
	}
	out := make([]projectVersionDTO, 0, len(versions))
	for _, v := range versions {
		out = append(out, projectVersionDTO{
			ID:        v.ID.String(),
			Seq:       v.Seq,
			Summary:   v.Summary,
			CreatedAt: formatTimeUTC(v.CreatedAt),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"versions": out})
}

type rollbackRequest struct {
	Seq int `json:"seq"`
}

// RollbackHandler POST /v1/projects/{id}/rollback -> {"project": {...}, "files": [...]}
func (h *ProjectHandlers) RollbackHandler(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	pid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid project id")
		return
	}
	var req rollbackRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Seq <= 0 {
		writeError(w, http.StatusBadRequest, "seq must be positive")
		return
	}
	p, files, err := h.Rollback.Execute(r.Context(), pid, uid, req.Seq)
	if err != nil {
		if errors.Is(err, projapp.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to rollback")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"project": toProjectDTO(*p),
		"files":   toProjectFileDTOs(files),
	})
}
