package httptransport

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	schedapp "github.com/open-polvo/open-polvo/internal/scheduledtasks/application"
	scheddom "github.com/open-polvo/open-polvo/internal/scheduledtasks/domain"
	schedports "github.com/open-polvo/open-polvo/internal/scheduledtasks/ports"
)

type ScheduleHandlers struct {
	Create *schedapp.CreateScheduledTask
	Get    *schedapp.GetScheduledTask
	List   *schedapp.ListScheduledTasks
	Update *schedapp.UpdateScheduledTask
	Delete *schedapp.DeleteScheduledTask
	Runner *schedapp.Runner
}

// GET /v1/scheduled-tasks
func (h *ScheduleHandlers) GetList(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	tasks, err := h.List.Execute(r.Context(), uid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "erro ao listar tarefas agendadas")
		return
	}
	if tasks == nil {
		tasks = []schedapp.ScheduledTaskDTO{}
	}
	writeJSON(w, http.StatusOK, tasks)
}

// POST /v1/scheduled-tasks
func (h *ScheduleHandlers) Post(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	var body struct {
		Name        string         `json:"name"`
		Description string         `json:"description"`
		TaskType    string         `json:"task_type"`
		Payload     map[string]any `json:"payload"`
		CronExpr    string         `json:"cron_expr"`
		Timezone    string         `json:"timezone"`
		Active      *bool          `json:"active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "json inválido")
		return
	}
	active := true
	if body.Active != nil {
		active = *body.Active
	}
	dto, err := h.Create.Execute(r.Context(), uid, schedapp.CreateInput{
		Name:        body.Name,
		Description: body.Description,
		TaskType:    scheddom.TaskType(body.TaskType),
		Payload:     body.Payload,
		CronExpr:    body.CronExpr,
		Timezone:    body.Timezone,
		Active:      active,
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, dto)
}

// GET /v1/scheduled-tasks/{id}
func (h *ScheduleHandlers) GetOne(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "id inválido")
		return
	}
	dto, err := h.Get.Execute(r.Context(), id, uid)
	if errors.Is(err, schedports.ErrNotFound) {
		writeError(w, http.StatusNotFound, "não encontrado")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "erro ao carregar")
		return
	}
	writeJSON(w, http.StatusOK, dto)
}

// PUT /v1/scheduled-tasks/{id}
func (h *ScheduleHandlers) Put(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "id inválido")
		return
	}
	var body struct {
		Name        string         `json:"name"`
		Description string         `json:"description"`
		TaskType    string         `json:"task_type"`
		Payload     map[string]any `json:"payload"`
		CronExpr    string         `json:"cron_expr"`
		Timezone    string         `json:"timezone"`
		Active      *bool          `json:"active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "json inválido")
		return
	}
	active := false
	if body.Active != nil {
		active = *body.Active
	} else {
		// Mantém o valor actual se não vier no payload.
		cur, err := h.Get.Execute(r.Context(), id, uid)
		if err == nil {
			active = cur.Active
		}
	}
	dto, err := h.Update.Execute(r.Context(), id, uid, schedapp.UpdateInput{
		Name:        body.Name,
		Description: body.Description,
		TaskType:    scheddom.TaskType(body.TaskType),
		Payload:     body.Payload,
		CronExpr:    body.CronExpr,
		Timezone:    body.Timezone,
		Active:      active,
	})
	if errors.Is(err, schedports.ErrNotFound) {
		writeError(w, http.StatusNotFound, "não encontrado")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, dto)
}

// DELETE /v1/scheduled-tasks/{id}
func (h *ScheduleHandlers) DeleteOne(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "id inválido")
		return
	}
	if err := h.Delete.Execute(r.Context(), id, uid); errors.Is(err, schedports.ErrNotFound) {
		writeError(w, http.StatusNotFound, "não encontrado")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "erro ao apagar")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// POST /v1/scheduled-tasks/{id}/run-now
func (h *ScheduleHandlers) RunNow(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	if h.Runner == nil {
		writeError(w, http.StatusServiceUnavailable, "runner não configurado")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "id inválido")
		return
	}
	out, runErr := h.Runner.ExecuteNow(r.Context(), id, uid)
	if runErr != nil {
		writeError(w, http.StatusBadRequest, runErr.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "result": out})
}
