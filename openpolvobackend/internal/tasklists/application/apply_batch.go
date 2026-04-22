package application

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/open-polvo/open-polvo/internal/tasklists/domain"
)

// ApplyTaskListBatch executa várias operações em sequência (sem transacção global).
type ApplyTaskListBatch struct {
	PatchListTitle *PatchTaskListTitle
	AppendItems    *AppendTaskItems
	PatchItem      *PatchTaskItem
	DeleteItem     *DeleteTaskItem
	CreateList     *CreateTaskList
	DeleteList     *DeleteTaskList
	RunList        *RunTaskList
}

// BatchRequest corpo de POST /v1/task-lists/batch.
type BatchRequest struct {
	Operations []json.RawMessage `json:"operations"`
}

// BatchStepResult resultado por operação.
type BatchStepResult struct {
	Op    string           `json:"op"`
	OK    bool             `json:"ok"`
	Error string           `json:"error,omitempty"`
	List  *json.RawMessage `json:"list,omitempty"`
}

// BatchResponse resposta agregada.
type BatchResponse struct {
	Steps []BatchStepResult `json:"steps"`
}

func marshalList(tl *domain.TaskList) *json.RawMessage {
	if tl == nil {
		return nil
	}
	// Serialização mínima: reutilizar mesma forma que HTTP — aqui só id/title/status/items count
	// O handler HTTP fará toTaskListDTO; para batch devolvemos JSON genérico via map.
	m := map[string]any{
		"id":         tl.ID.String(),
		"title":      tl.Title,
		"status":     string(tl.Status),
		"created_at": tl.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		"updated_at": tl.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
	if len(tl.Items) > 0 {
		items := make([]map[string]any, 0, len(tl.Items))
		for _, it := range tl.Items {
			row := map[string]any{
				"id":       it.ID.String(),
				"position": it.Position,
				"title":    it.Title,
				"status":   string(it.Status),
			}
			if it.Description != nil {
				row["description"] = *it.Description
			}
			items = append(items, row)
		}
		m["items"] = items
	}
	raw, _ := json.Marshal(m)
	rm := json.RawMessage(raw)
	return &rm
}

// Execute corre cada operação; erros não abortam as seguintes.
func (uc *ApplyTaskListBatch) Execute(ctx context.Context, userID uuid.UUID, req *BatchRequest) *BatchResponse {
	out := &BatchResponse{Steps: make([]BatchStepResult, 0, len(req.Operations))}
	if req == nil || len(req.Operations) == 0 {
		return out
	}
	for _, raw := range req.Operations {
		var head struct {
			Op string `json:"op"`
		}
		if err := json.Unmarshal(raw, &head); err != nil {
			out.Steps = append(out.Steps, BatchStepResult{Op: "", OK: false, Error: "op inválida: " + err.Error()})
			continue
		}
		step := BatchStepResult{Op: head.Op}
		switch head.Op {
		case "patch_list_title":
			step = uc.applyPatchListTitle(ctx, userID, raw)
		case "append_items":
			step = uc.applyAppendItems(ctx, userID, raw)
		case "patch_item":
			step = uc.applyPatchItem(ctx, userID, raw)
		case "delete_item":
			step = uc.applyDeleteItem(ctx, userID, raw)
		case "create_list":
			step = uc.applyCreateList(ctx, userID, raw)
		case "delete_list":
			step = uc.applyDeleteList(ctx, userID, raw)
		case "delete_lists":
			step = uc.applyDeleteLists(ctx, userID, raw)
		case "run_list":
			step = uc.applyRunList(ctx, userID, raw)
		default:
			step = BatchStepResult{Op: head.Op, OK: false, Error: "op desconhecida: " + head.Op}
		}
		out.Steps = append(out.Steps, step)
	}
	return out
}

func (uc *ApplyTaskListBatch) applyPatchListTitle(ctx context.Context, userID uuid.UUID, raw json.RawMessage) BatchStepResult {
	var body struct {
		Op     string `json:"op"`
		ListID string `json:"list_id"`
		Title  string `json:"title"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return BatchStepResult{Op: "patch_list_title", OK: false, Error: err.Error()}
	}
	lid, err := uuid.Parse(body.ListID)
	if err != nil {
		return BatchStepResult{Op: "patch_list_title", OK: false, Error: "list_id inválido"}
	}
	if uc.PatchListTitle == nil {
		return BatchStepResult{Op: "patch_list_title", OK: false, Error: "não configurado"}
	}
	tl, err := uc.PatchListTitle.Execute(ctx, userID, lid, body.Title)
	if err != nil {
		return BatchStepResult{Op: "patch_list_title", OK: false, Error: err.Error()}
	}
	return BatchStepResult{Op: "patch_list_title", OK: true, List: marshalList(tl)}
}

func (uc *ApplyTaskListBatch) applyAppendItems(ctx context.Context, userID uuid.UUID, raw json.RawMessage) BatchStepResult {
	var body struct {
		Op     string `json:"op"`
		ListID string `json:"list_id"`
		Items  []struct {
			Title       string `json:"title"`
			Description string `json:"description"`
		} `json:"items"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return BatchStepResult{Op: "append_items", OK: false, Error: err.Error()}
	}
	lid, err := uuid.Parse(body.ListID)
	if err != nil {
		return BatchStepResult{Op: "append_items", OK: false, Error: "list_id inválido"}
	}
	var ins []CreateTaskItemInput
	for _, it := range body.Items {
		ins = append(ins, CreateTaskItemInput{Title: it.Title, Description: it.Description})
	}
	if uc.AppendItems == nil {
		return BatchStepResult{Op: "append_items", OK: false, Error: "não configurado"}
	}
	tl, err := uc.AppendItems.Execute(ctx, userID, lid, ins)
	if err != nil {
		return BatchStepResult{Op: "append_items", OK: false, Error: err.Error()}
	}
	return BatchStepResult{Op: "append_items", OK: true, List: marshalList(tl)}
}

func (uc *ApplyTaskListBatch) applyPatchItem(ctx context.Context, userID uuid.UUID, raw json.RawMessage) BatchStepResult {
	var body struct {
		Op          string  `json:"op"`
		ListID      string  `json:"list_id"`
		ItemID      string  `json:"item_id"`
		Title       *string `json:"title"`
		Description *string `json:"description"`
		Position    *int    `json:"position"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return BatchStepResult{Op: "patch_item", OK: false, Error: err.Error()}
	}
	lid, err := uuid.Parse(body.ListID)
	if err != nil {
		return BatchStepResult{Op: "patch_item", OK: false, Error: "list_id inválido"}
	}
	iid, err := uuid.Parse(body.ItemID)
	if err != nil {
		return BatchStepResult{Op: "patch_item", OK: false, Error: "item_id inválido"}
	}
	if uc.PatchItem == nil {
		return BatchStepResult{Op: "patch_item", OK: false, Error: "não configurado"}
	}
	tl, err := uc.PatchItem.Execute(ctx, userID, lid, iid, PatchTaskItemInput{
		Title: body.Title, Description: body.Description, Position: body.Position,
	})
	if err != nil {
		return BatchStepResult{Op: "patch_item", OK: false, Error: err.Error()}
	}
	return BatchStepResult{Op: "patch_item", OK: true, List: marshalList(tl)}
}

func (uc *ApplyTaskListBatch) applyDeleteItem(ctx context.Context, userID uuid.UUID, raw json.RawMessage) BatchStepResult {
	var body struct {
		Op     string `json:"op"`
		ListID string `json:"list_id"`
		ItemID string `json:"item_id"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return BatchStepResult{Op: "delete_item", OK: false, Error: err.Error()}
	}
	lid, err := uuid.Parse(body.ListID)
	if err != nil {
		return BatchStepResult{Op: "delete_item", OK: false, Error: "list_id inválido"}
	}
	iid, err := uuid.Parse(body.ItemID)
	if err != nil {
		return BatchStepResult{Op: "delete_item", OK: false, Error: "item_id inválido"}
	}
	if uc.DeleteItem == nil {
		return BatchStepResult{Op: "delete_item", OK: false, Error: "não configurado"}
	}
	tl, err := uc.DeleteItem.Execute(ctx, userID, lid, iid)
	if err != nil {
		return BatchStepResult{Op: "delete_item", OK: false, Error: err.Error()}
	}
	return BatchStepResult{Op: "delete_item", OK: true, List: marshalList(tl)}
}

func (uc *ApplyTaskListBatch) applyCreateList(ctx context.Context, userID uuid.UUID, raw json.RawMessage) BatchStepResult {
	var body struct {
		Op    string `json:"op"`
		Title string `json:"title"`
		Items []struct {
			Title       string `json:"title"`
			Description string `json:"description"`
		} `json:"items"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return BatchStepResult{Op: "create_list", OK: false, Error: err.Error()}
	}
	if uc.CreateList == nil {
		return BatchStepResult{Op: "create_list", OK: false, Error: "não configurado"}
	}
	in := CreateTaskListInput{Title: body.Title}
	for _, it := range body.Items {
		in.Items = append(in.Items, CreateTaskItemInput{Title: it.Title, Description: it.Description})
	}
	tl, err := uc.CreateList.Execute(ctx, userID, in)
	if err != nil {
		return BatchStepResult{Op: "create_list", OK: false, Error: err.Error()}
	}
	return BatchStepResult{Op: "create_list", OK: true, List: marshalList(tl)}
}

func (uc *ApplyTaskListBatch) applyDeleteLists(ctx context.Context, userID uuid.UUID, raw json.RawMessage) BatchStepResult {
	var body struct {
		Op  string   `json:"op"`
		IDs []string `json:"ids"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return BatchStepResult{Op: "delete_lists", OK: false, Error: err.Error()}
	}
	if uc.DeleteList == nil {
		return BatchStepResult{Op: "delete_lists", OK: false, Error: "não configurado"}
	}
	var lastErr string
	okCount := 0
	for _, sid := range body.IDs {
		lid, err := uuid.Parse(sid)
		if err != nil {
			lastErr = "id inválido: " + sid
			continue
		}
		if err := uc.DeleteList.Execute(ctx, userID, lid); err != nil {
			lastErr = err.Error()
			continue
		}
		okCount++
	}
	if okCount == 0 && lastErr != "" {
		return BatchStepResult{Op: "delete_lists", OK: false, Error: lastErr}
	}
	return BatchStepResult{Op: "delete_lists", OK: true}
}

func (uc *ApplyTaskListBatch) applyDeleteList(ctx context.Context, userID uuid.UUID, raw json.RawMessage) BatchStepResult {
	var body struct {
		Op     string `json:"op"`
		ListID string `json:"list_id"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return BatchStepResult{Op: "delete_list", OK: false, Error: err.Error()}
	}
	lid, err := uuid.Parse(body.ListID)
	if err != nil {
		return BatchStepResult{Op: "delete_list", OK: false, Error: "list_id inválido"}
	}
	if uc.DeleteList == nil {
		return BatchStepResult{Op: "delete_list", OK: false, Error: "não configurado"}
	}
	if err := uc.DeleteList.Execute(ctx, userID, lid); err != nil {
		return BatchStepResult{Op: "delete_list", OK: false, Error: err.Error()}
	}
	return BatchStepResult{Op: "delete_list", OK: true}
}

func (uc *ApplyTaskListBatch) applyRunList(ctx context.Context, userID uuid.UUID, raw json.RawMessage) BatchStepResult {
	var body struct {
		Op     string `json:"op"`
		ListID string `json:"list_id"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return BatchStepResult{Op: "run_list", OK: false, Error: err.Error()}
	}
	lid, err := uuid.Parse(body.ListID)
	if err != nil {
		return BatchStepResult{Op: "run_list", OK: false, Error: "list_id inválido"}
	}
	if uc.RunList == nil {
		return BatchStepResult{Op: "run_list", OK: false, Error: "não configurado"}
	}
	tl, err := uc.RunList.Execute(ctx, userID, lid)
	if err != nil {
		return BatchStepResult{Op: "run_list", OK: false, Error: err.Error()}
	}
	return BatchStepResult{Op: "run_list", OK: true, List: marshalList(tl)}
}
