package httptransport

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	taskapp "github.com/open-polvo/open-polvo/internal/tasklists/application"
	"github.com/open-polvo/open-polvo/internal/tasklists/domain"
)

// TaskListHandlers agrupa os handlers HTTP para o domínio tasklists.
type TaskListHandlers struct {
	Create *taskapp.CreateTaskList
	Get    *taskapp.GetTaskList
	List   *taskapp.ListTaskLists
	Delete *taskapp.DeleteTaskList
	Run    *taskapp.RunTaskList
}

// ─── DTOs ────────────────────────────────────────────────────────────────────

type taskItemDTO struct {
	ID          string  `json:"id"`
	Position    int     `json:"position"`
	Title       string  `json:"title"`
	Description *string `json:"description,omitempty"`
	Status      string  `json:"status"`
	Result      *string `json:"result,omitempty"`
	ErrorMsg    *string `json:"error_msg,omitempty"`
	StartedAt   *string `json:"started_at,omitempty"`
	FinishedAt  *string `json:"finished_at,omitempty"`
}

type taskListDTO struct {
	ID         string        `json:"id"`
	Title      string        `json:"title"`
	Status     string        `json:"status"`
	Items      []taskItemDTO `json:"items,omitempty"`
	CreatedAt  string        `json:"created_at"`
	UpdatedAt  string        `json:"updated_at"`
	FinishedAt *string       `json:"finished_at,omitempty"`
}

func toTaskItemDTO(item domain.TaskItem) taskItemDTO {
	d := taskItemDTO{
		ID:          item.ID.String(),
		Position:    item.Position,
		Title:       item.Title,
		Description: item.Description,
		Status:      string(item.Status),
		Result:      item.Result,
		ErrorMsg:    item.ErrorMsg,
	}
	if item.StartedAt != nil {
		s := formatTimeUTC(*item.StartedAt)
		d.StartedAt = &s
	}
	if item.FinishedAt != nil {
		s := formatTimeUTC(*item.FinishedAt)
		d.FinishedAt = &s
	}
	return d
}

func toTaskListDTO(tl *domain.TaskList) taskListDTO {
	d := taskListDTO{
		ID:        tl.ID.String(),
		Title:     tl.Title,
		Status:    string(tl.Status),
		CreatedAt: formatTimeUTC(tl.CreatedAt),
		UpdatedAt: formatTimeUTC(tl.UpdatedAt),
	}
	if tl.FinishedAt != nil {
		s := formatTimeUTC(*tl.FinishedAt)
		d.FinishedAt = &s
	}
	if len(tl.Items) > 0 {
		d.Items = make([]taskItemDTO, len(tl.Items))
		for i, item := range tl.Items {
			d.Items[i] = toTaskItemDTO(item)
		}
	}
	return d
}

// ─── Handlers ────────────────────────────────────────────────────────────────

// PostTaskList cria uma nova lista de tarefas com os seus items.
func (h *TaskListHandlers) PostTaskList(w http.ResponseWriter, r *http.Request) {
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil {
		return
	}

	var body struct {
		Title string `json:"title"`
		Items []struct {
			Title       string `json:"title"`
			Description string `json:"description"`
		} `json:"items"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corpo inválido")
		return
	}
	if body.Title == "" {
		writeError(w, http.StatusBadRequest, "title obrigatório")
		return
	}

	in := taskapp.CreateTaskListInput{Title: body.Title}
	for _, it := range body.Items {
		if it.Title == "" {
			continue
		}
		in.Items = append(in.Items, taskapp.CreateTaskItemInput{
			Title:       it.Title,
			Description: it.Description,
		})
	}

	tl, err := h.Create.Execute(r.Context(), userID, in)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "erro ao criar lista")
		return
	}
	writeJSON(w, http.StatusCreated, toTaskListDTO(tl))
}

// GetTaskLists lista todas as listas do utilizador (sem items).
func (h *TaskListHandlers) GetTaskLists(w http.ResponseWriter, r *http.Request) {
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil {
		return
	}
	lists, err := h.List.Execute(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "erro ao listar")
		return
	}
	dtos := make([]taskListDTO, 0, len(lists))
	for i := range lists {
		dtos = append(dtos, toTaskListDTO(&lists[i]))
	}
	writeJSON(w, http.StatusOK, dtos)
}

// GetTaskList devolve uma lista com todos os seus items e resultados.
func (h *TaskListHandlers) GetTaskList(w http.ResponseWriter, r *http.Request) {
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "id inválido")
		return
	}
	tl, err := h.Get.Execute(r.Context(), userID, id)
	if err != nil {
		if errors.Is(err, taskapp.ErrTaskListNotFound) || errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "não encontrado")
			return
		}
		writeError(w, http.StatusInternalServerError, "erro ao obter lista")
		return
	}
	writeJSON(w, http.StatusOK, toTaskListDTO(tl))
}

// DeleteTaskList apaga uma lista (cascade apaga os items).
func (h *TaskListHandlers) DeleteTaskList(w http.ResponseWriter, r *http.Request) {
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "id inválido")
		return
	}
	if err := h.Delete.Execute(r.Context(), userID, id); err != nil {
		if errors.Is(err, taskapp.ErrTaskListNotFound) || errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "não encontrado")
			return
		}
		writeError(w, http.StatusInternalServerError, "erro ao apagar")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// PostTaskListRun activa o agente executor. Responde 202 imediatamente.
func (h *TaskListHandlers) PostTaskListRun(w http.ResponseWriter, r *http.Request) {
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "id inválido")
		return
	}
	tl, err := h.Run.Execute(r.Context(), userID, id)
	if err != nil {
		switch {
		case errors.Is(err, taskapp.ErrTaskListNotFound):
			writeError(w, http.StatusNotFound, "não encontrado")
		case errors.Is(err, taskapp.ErrAlreadyRunning):
			writeError(w, http.StatusConflict, "lista já está em execução ou não está em estado pending")
		case errors.Is(err, taskapp.ErrExecutorNotConfigured):
			writeError(w, http.StatusServiceUnavailable, "executor de tarefas não configurado")
		default:
			writeError(w, http.StatusInternalServerError, "erro ao activar agente")
		}
		return
	}
	writeJSON(w, http.StatusAccepted, toTaskListDTO(tl))
}
