package httptransport

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/conversations/domain"
	wfapp "github.com/open-polvo/open-polvo/internal/workflows/application"
	wfdomain "github.com/open-polvo/open-polvo/internal/workflows/domain"
)

type WorkflowHandlers struct {
	Create        *wfapp.CreateWorkflow
	Update        *wfapp.UpdateWorkflow
	Get           *wfapp.GetWorkflow
	List          *wfapp.ListWorkflows
	Delete        *wfapp.DeleteWorkflow
	Pin           *wfapp.PinWorkflow
	Run           *wfapp.RunWorkflow
	Generate      *wfapp.GenerateWorkflow
	SaveGenerated *wfapp.SaveGeneratedWorkflow
	ListRuns      *wfapp.ListWorkflowRuns
}

type workflowDTO struct {
	ID                    string             `json:"id"`
	Title                 string             `json:"title"`
	Graph                 wfdomain.GraphJSON `json:"graph"`
	PinnedAt              *string            `json:"pinned_at,omitempty"`
	ScheduleCron          *string            `json:"schedule_cron,omitempty"`
	ScheduleTimezone      string             `json:"schedule_timezone,omitempty"`
	ScheduleEnabled       bool               `json:"schedule_enabled"`
	ScheduleLastFiredAt   *string            `json:"schedule_last_fired_at,omitempty"`
	CreatedAt             string             `json:"created_at"`
	UpdatedAt             string             `json:"updated_at"`
}

type runDTO struct {
	ID           string                  `json:"id"`
	WorkflowID   string                  `json:"workflow_id"`
	Status       string                  `json:"status"`
	StepLog      []wfdomain.StepLogEntry `json:"step_log,omitempty"`
	ErrorMessage *string                 `json:"error_message,omitempty"`
	CreatedAt    string                  `json:"created_at"`
	FinishedAt   *string                 `json:"finished_at,omitempty"`
}

func toWorkflowDTO(w *wfdomain.Workflow) workflowDTO {
	d := workflowDTO{
		ID:               w.ID.String(),
		Title:            w.Title,
		Graph:            w.Graph,
		ScheduleTimezone: w.ScheduleTimezone,
		ScheduleEnabled:  w.ScheduleEnabled,
		CreatedAt:        formatTimeUTC(w.CreatedAt),
		UpdatedAt:        formatTimeUTC(w.UpdatedAt),
	}
	if w.PinnedAt != nil {
		s := formatTimeUTC(*w.PinnedAt)
		d.PinnedAt = &s
	}
	if w.ScheduleCron != nil && *w.ScheduleCron != "" {
		c := *w.ScheduleCron
		d.ScheduleCron = &c
	}
	if w.ScheduleLastFiredAt != nil {
		s := formatTimeUTC(*w.ScheduleLastFiredAt)
		d.ScheduleLastFiredAt = &s
	}
	return d
}

func toRunDTO(r *wfdomain.WorkflowRun) runDTO {
	d := runDTO{
		ID:         r.ID.String(),
		WorkflowID: r.WorkflowID.String(),
		Status:     string(r.Status),
		StepLog:    r.StepLog,
		CreatedAt:  formatTimeUTC(r.CreatedAt),
	}
	if r.ErrorMessage != nil {
		d.ErrorMessage = r.ErrorMessage
	}
	if r.FinishedAt != nil {
		s := formatTimeUTC(*r.FinishedAt)
		d.FinishedAt = &s
	}
	return d
}

func (h *WorkflowHandlers) GetWorkflows(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	list, err := h.List.Execute(r.Context(), uid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list workflows")
		return
	}
	out := make([]workflowDTO, 0, len(list))
	for i := range list {
		out = append(out, toWorkflowDTO(&list[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

type postWorkflowBody struct {
	Title string             `json:"title"`
	Graph wfdomain.GraphJSON `json:"graph"`
}

func (h *WorkflowHandlers) PostWorkflow(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	var body postWorkflowBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	wf, err := h.Create.Execute(r.Context(), uid, body.Title, body.Graph)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create workflow")
		return
	}
	writeJSON(w, http.StatusCreated, toWorkflowDTO(wf))
}

func (h *WorkflowHandlers) GetWorkflow(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	wf, err := h.Get.Execute(r.Context(), uid, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load workflow")
		return
	}
	writeJSON(w, http.StatusOK, toWorkflowDTO(wf))
}

func (h *WorkflowHandlers) PatchWorkflow(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body patchWorkflowRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if body.Title == nil && body.Graph == nil {
		writeError(w, http.StatusBadRequest, "title or graph required")
		return
	}
	wf, err := h.Update.Execute(r.Context(), uid, id, body.Title, body.Graph)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to update")
		return
	}
	writeJSON(w, http.StatusOK, toWorkflowDTO(wf))
}

type patchWorkflowRequest struct {
	Title *string             `json:"title,omitempty"`
	Graph *wfdomain.GraphJSON `json:"graph,omitempty"`
}

type pinWorkflowBody struct {
	Pinned bool `json:"pinned"`
}

func (h *WorkflowHandlers) PostWorkflowPin(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body pinWorkflowBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if err := h.Pin.Execute(r.Context(), id, uid, body.Pinned); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to pin")
		return
	}
	wf, err := h.Get.Execute(r.Context(), uid, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load workflow")
		return
	}
	writeJSON(w, http.StatusOK, toWorkflowDTO(wf))
}

func (h *WorkflowHandlers) DeleteWorkflow(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.Delete.Execute(r.Context(), uid, id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *WorkflowHandlers) PostWorkflowRun(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	wid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	run, err := h.Run.Execute(r.Context(), uid, wid)
	if err != nil {
		if errors.Is(err, wfapp.ErrWorkflowNotFound) {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		writeError(w, http.StatusInternalServerError, truncateForClientErr(err.Error(), 400))
		return
	}
	writeJSON(w, http.StatusOK, toRunDTO(run))
}

func (h *WorkflowHandlers) GetWorkflowRuns(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	wid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	list, err := h.ListRuns.Execute(r.Context(), uid, wid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list runs")
		return
	}
	out := make([]runDTO, 0, len(list))
	for i := range list {
		out = append(out, toRunDTO(&list[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

type generateBody struct {
	Prompt        string `json:"prompt"`
	RecordingJSON string `json:"recording_json,omitempty"`
	ModelProvider string `json:"model_provider,omitempty"`
	SaveTitle     string `json:"save_title,omitempty"`
}

func (h *WorkflowHandlers) PostWorkflowGenerate(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	var body generateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if body.Prompt == "" {
		writeError(w, http.StatusBadRequest, "prompt required")
		return
	}
	mp := domain.ModelOpenAI
	if body.ModelProvider != "" {
		var ok bool
		mp, ok = domain.ParseModelProvider(body.ModelProvider)
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid model_provider")
			return
		}
	}
	g, raw, err := h.Generate.Execute(r.Context(), mp, body.Prompt, body.RecordingJSON)
	if err != nil {
		if errors.Is(err, wfapp.ErrLLMNotConfigured) {
			writeError(w, http.StatusServiceUnavailable, "LLM not configured")
			return
		}
		// Falha ao interpretar JSON do modelo: devolve raw para o utilizador corrigir.
		if g.Nodes == nil && raw != "" {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
				"error":   truncateForClientErr(err.Error(), 400),
				"raw_llm": raw,
			})
			return
		}
		writeError(w, http.StatusBadGateway, truncateForClientErr(err.Error(), 400))
		return
	}
	resp := map[string]any{"graph": g, "raw_llm": raw}
	if body.SaveTitle != "" && h.SaveGenerated != nil {
		wf, err := h.SaveGenerated.Execute(r.Context(), uid, body.SaveTitle, g)
		if err == nil {
			resp["saved"] = toWorkflowDTO(wf)
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

func mustUserUUID(w http.ResponseWriter, r *http.Request) uuid.UUID {
	uidStr, _, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return uuid.Nil
	}
	uid, err := uuid.Parse(uidStr)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid user")
		return uuid.Nil
	}
	return uid
}
