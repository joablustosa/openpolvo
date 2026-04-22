package httptransport

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	taskapp "github.com/open-polvo/open-polvo/internal/tasklists/application"
	"github.com/open-polvo/open-polvo/internal/tasklists/domain"
)

// TaskListHandlers agrupa os handlers HTTP para o domínio tasklists.
type TaskListHandlers struct {
	Create     *taskapp.CreateTaskList
	Get        *taskapp.GetTaskList
	List       *taskapp.ListTaskLists
	Delete     *taskapp.DeleteTaskList
	Run        *taskapp.RunTaskList
	PatchTitle *taskapp.PatchTaskListTitle
	Append     *taskapp.AppendTaskItems
	PatchItem  *taskapp.PatchTaskItem
	DeleteItem *taskapp.DeleteTaskItem
	Batch      *taskapp.ApplyTaskListBatch
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
	DueAt       *string `json:"due_at,omitempty"`
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
	if item.DueAt != nil {
		s := formatTimeUTC(*item.DueAt)
		d.DueAt = &s
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

func taskListMutationErr(w http.ResponseWriter, err error) bool {
	switch {
	case errors.Is(err, taskapp.ErrTaskListNotFound), errors.Is(err, taskapp.ErrTaskItemNotFound):
		writeError(w, http.StatusNotFound, "não encontrado")
		return true
	case errors.Is(err, taskapp.ErrListRunningMutation), errors.Is(err, taskapp.ErrAlreadyRunning):
		writeError(w, http.StatusConflict, err.Error())
		return true
	case errors.Is(err, taskapp.ErrItemNotEditable):
		writeError(w, http.StatusConflict, err.Error())
		return true
	default:
		return false
	}
}

// PatchTaskList actualiza o título da lista (JSON: {"title":"..."}).
func (h *TaskListHandlers) PatchTaskList(w http.ResponseWriter, r *http.Request) {
	if h.PatchTitle == nil || h.Get == nil {
		writeError(w, http.StatusServiceUnavailable, "operação indisponível")
		return
	}
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "id inválido")
		return
	}
	var body struct {
		Title string `json:"title"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corpo inválido")
		return
	}
	if _, err := h.PatchTitle.Execute(r.Context(), userID, id, body.Title); err != nil {
		if taskListMutationErr(w, err) {
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	tl, err := h.Get.Execute(r.Context(), userID, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "erro ao obter lista")
		return
	}
	writeJSON(w, http.StatusOK, toTaskListDTO(tl))
}

// PostTaskListItems adiciona items a uma lista existente.
func (h *TaskListHandlers) PostTaskListItems(w http.ResponseWriter, r *http.Request) {
	if h.Append == nil {
		writeError(w, http.StatusServiceUnavailable, "operação indisponível")
		return
	}
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "id inválido")
		return
	}
	var body struct {
		Items []struct {
			Title       string `json:"title"`
			Description string `json:"description"`
		} `json:"items"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corpo inválido")
		return
	}
	var in []taskapp.CreateTaskItemInput
	for _, it := range body.Items {
		in = append(in, taskapp.CreateTaskItemInput{Title: it.Title, Description: it.Description})
	}
	tl, err := h.Append.Execute(r.Context(), userID, id, in)
	if err != nil {
		if taskListMutationErr(w, err) {
			return
		}
		writeError(w, http.StatusInternalServerError, "erro ao adicionar items")
		return
	}
	writeJSON(w, http.StatusOK, toTaskListDTO(tl))
}

// PatchTaskListItem actualiza um item pendente (title, description, position opcionais).
func (h *TaskListHandlers) PatchTaskListItem(w http.ResponseWriter, r *http.Request) {
	if h.PatchItem == nil {
		writeError(w, http.StatusServiceUnavailable, "operação indisponível")
		return
	}
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil {
		return
	}
	lid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "id de lista inválido")
		return
	}
	iid, err := uuid.Parse(chi.URLParam(r, "itemID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "item_id inválido")
		return
	}
	var body struct {
		Title       *string         `json:"title"`
		Description *string         `json:"description"`
		Position    *int            `json:"position"`
		DueAt       json.RawMessage `json:"due_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corpo inválido")
		return
	}
	patchIn := taskapp.PatchTaskItemInput{
		Title: body.Title, Description: body.Description, Position: body.Position,
	}
	if len(body.DueAt) > 0 {
		raw := strings.TrimSpace(string(body.DueAt))
		if raw == "null" {
			patchIn.DueAtClear = true
		} else {
			var s string
			if err := json.Unmarshal(body.DueAt, &s); err != nil {
				writeError(w, http.StatusBadRequest, "due_at inválido")
				return
			}
			s = strings.TrimSpace(s)
			if s != "" {
				t, err := time.Parse(time.RFC3339Nano, s)
				if err != nil {
					t, err = time.Parse(time.RFC3339, s)
				}
				if err != nil {
					writeError(w, http.StatusBadRequest, "due_at: use ISO-8601 (RFC3339)")
					return
				}
				patchIn.DueAt = &t
			}
		}
	}
	tl, err := h.PatchItem.Execute(r.Context(), userID, lid, iid, patchIn)
	if err != nil {
		if taskListMutationErr(w, err) {
			return
		}
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, toTaskListDTO(tl))
}

// DeleteTaskListItem remove um item pendente.
func (h *TaskListHandlers) DeleteTaskListItem(w http.ResponseWriter, r *http.Request) {
	if h.DeleteItem == nil {
		writeError(w, http.StatusServiceUnavailable, "operação indisponível")
		return
	}
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil {
		return
	}
	lid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "id de lista inválido")
		return
	}
	iid, err := uuid.Parse(chi.URLParam(r, "itemID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "item_id inválido")
		return
	}
	tl, err := h.DeleteItem.Execute(r.Context(), userID, lid, iid)
	if err != nil {
		if taskListMutationErr(w, err) {
			return
		}
		writeError(w, http.StatusInternalServerError, "erro ao apagar item")
		return
	}
	writeJSON(w, http.StatusOK, toTaskListDTO(tl))
}

// PostTaskListBatch aplica várias operações (ver README).
func (h *TaskListHandlers) PostTaskListBatch(w http.ResponseWriter, r *http.Request) {
	if h.Batch == nil {
		writeError(w, http.StatusServiceUnavailable, "operação indisponível")
		return
	}
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil {
		return
	}
	var req taskapp.BatchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "corpo inválido")
		return
	}
	resp := h.Batch.Execute(r.Context(), userID, &req)
	writeJSON(w, http.StatusOK, resp)
}
