package httptransport

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	financesqlite "github.com/open-polvo/open-polvo/internal/finance/adapters/sqlite"
	"github.com/open-polvo/open-polvo/internal/finance/domain"
	tasklistsports "github.com/open-polvo/open-polvo/internal/tasklists/ports"
)

// FinanceHandlers expõe finanças pessoais, digest e agenda unificada.
type FinanceHandlers struct {
	Repo      *financesqlite.Store
	TaskItems tasklistsports.TaskItemRepository
}

type agendaEventDTO struct {
	Type     string         `json:"type"`
	ID       string         `json:"id"`
	Title    string         `json:"title"`
	StartsAt string         `json:"starts_at"`
	EndsAt   *string        `json:"ends_at,omitempty"`
	Payload  map[string]any `json:"payload,omitempty"`
}

// GetAgenda GET /v1/agenda?from=&to= RFC3339
func (h *FinanceHandlers) GetAgenda(w http.ResponseWriter, r *http.Request) {
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil {
		return
	}
	if h.Repo == nil || h.TaskItems == nil {
		writeError(w, http.StatusServiceUnavailable, "agenda indisponível")
		return
	}
	fromS := strings.TrimSpace(r.URL.Query().Get("from"))
	toS := strings.TrimSpace(r.URL.Query().Get("to"))
	if fromS == "" || toS == "" {
		writeError(w, http.StatusBadRequest, "from e to obrigatórios (RFC3339)")
		return
	}
	from, err := time.Parse(time.RFC3339, fromS)
	if err != nil {
		writeError(w, http.StatusBadRequest, "from inválido")
		return
	}
	to, err := time.Parse(time.RFC3339, toS)
	if err != nil || !to.After(from) {
		writeError(w, http.StatusBadRequest, "to inválido")
		return
	}
	var events []agendaEventDTO

	// Tarefas com prazo
	dueRows, err := h.TaskItems.ListDueInRangeForUser(r.Context(), userID, from, to)
	if err == nil {
		for _, row := range dueRows {
			st := row.DueAt.UTC().Format(time.RFC3339)
			events = append(events, agendaEventDTO{
				Type: "task", ID: row.ItemID.String(),
				Title: row.ListTitle + ": " + row.Title,
				StartsAt: st,
				Payload: map[string]any{"task_list_id": row.TaskListID.String()},
			})
		}
	}

	// Transacções
	txs, err := h.Repo.ListTransactionsByRange(r.Context(), userID, from, to, nil)
	if err == nil {
		for i := range txs {
			t := &txs[i]
			st := t.OccurredAt.UTC().Format(time.RFC3339)
			dir := string(t.Direction)
			title := t.Description
			if title == "" {
				title = dir + " " + t.Currency
			}
			events = append(events, agendaEventDTO{
				Type: "transaction", ID: t.ID.String(), Title: title, StartsAt: st,
				Payload: map[string]any{"amount_minor": t.AmountMinor, "currency": t.Currency, "direction": dir},
			})
		}
	}

	// Assinaturas com vencimento no intervalo
	subs, err := h.Repo.ListSubscriptionsByUser(r.Context(), userID)
	if err == nil {
		for i := range subs {
			s := &subs[i]
			if s.Status != domain.SubActive {
				continue
			}
			nd := s.NextDueAt
			if nd.Before(from) || !nd.Before(to) {
				continue
			}
			st := nd.UTC().Format(time.RFC3339)
			events = append(events, agendaEventDTO{
				Type: "subscription", ID: s.ID.String(), Title: s.Name, StartsAt: st,
				Payload: map[string]any{"amount_minor": s.AmountMinor, "currency": s.Currency, "cadence": string(s.Cadence)},
			})
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"events": events})
}

// --- Categories (Store as CategoryRepository) ---

func (h *FinanceHandlers) PostCategory(w http.ResponseWriter, r *http.Request) {
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil || h.Repo == nil {
		return
	}
	var body struct {
		Name     string  `json:"name"`
		ParentID *string `json:"parent_id"`
		SortOrder int    `json:"sort_order"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Name) == "" {
		writeError(w, http.StatusBadRequest, "name obrigatório")
		return
	}
	now := time.Now().UTC()
	c := &domain.Category{
		ID: uuid.New(), UserID: userID, Name: strings.TrimSpace(body.Name), SortOrder: body.SortOrder,
		CreatedAt: now, UpdatedAt: now,
	}
	if body.ParentID != nil && strings.TrimSpace(*body.ParentID) != "" {
		p, err := uuid.Parse(strings.TrimSpace(*body.ParentID))
		if err != nil {
			writeError(w, http.StatusBadRequest, "parent_id inválido")
			return
		}
		c.ParentID = &p
	}
	if err := h.Repo.CreateCategory(r.Context(), c); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, categoryToJSON(c))
}

func (h *FinanceHandlers) GetCategories(w http.ResponseWriter, r *http.Request) {
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil || h.Repo == nil {
		return
	}
	list, err := h.Repo.ListCategoriesByUser(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "erro ao listar")
		return
	}
	out := make([]any, 0, len(list))
	for i := range list {
		out = append(out, categoryToJSON(&list[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *FinanceHandlers) PatchCategory(w http.ResponseWriter, r *http.Request) {
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil || h.Repo == nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "id inválido")
		return
	}
	c, err := h.Repo.GetCategory(r.Context(), id, userID)
	if err != nil {
		writeError(w, http.StatusNotFound, "não encontrado")
		return
	}
	var body struct {
		Name      *string `json:"name"`
		ParentID  *string `json:"parent_id"`
		SortOrder *int    `json:"sort_order"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corpo inválido")
		return
	}
	if body.Name != nil {
		if strings.TrimSpace(*body.Name) == "" {
			writeError(w, http.StatusBadRequest, "name vazio")
			return
		}
		c.Name = strings.TrimSpace(*body.Name)
	}
	if body.ParentID != nil {
		if strings.TrimSpace(*body.ParentID) == "" {
			c.ParentID = nil
		} else {
			p, err := uuid.Parse(strings.TrimSpace(*body.ParentID))
			if err != nil {
				writeError(w, http.StatusBadRequest, "parent_id inválido")
				return
			}
			c.ParentID = &p
		}
	}
	if body.SortOrder != nil {
		c.SortOrder = *body.SortOrder
	}
	c.UpdatedAt = time.Now().UTC()
	if err := h.Repo.UpdateCategory(r.Context(), c); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, categoryToJSON(c))
}

func (h *FinanceHandlers) DeleteCategory(w http.ResponseWriter, r *http.Request) {
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil || h.Repo == nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "id inválido")
		return
	}
	if err := h.Repo.DeleteCategory(r.Context(), id, userID); err != nil {
		writeError(w, http.StatusNotFound, "não encontrado")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func categoryToJSON(c *domain.Category) map[string]any {
	m := map[string]any{
		"id": c.ID.String(), "user_id": c.UserID.String(), "name": c.Name, "sort_order": c.SortOrder,
		"created_at": formatTimeUTC(c.CreatedAt), "updated_at": formatTimeUTC(c.UpdatedAt),
	}
	if c.ParentID != nil {
		m["parent_id"] = c.ParentID.String()
	}
	return m
}

// --- Transactions ---

func (h *FinanceHandlers) PostTransaction(w http.ResponseWriter, r *http.Request) {
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil || h.Repo == nil {
		return
	}
	var body struct {
		AmountMinor   int64   `json:"amount_minor"`
		Currency      string  `json:"currency"`
		Direction       string  `json:"direction"`
		CategoryID    *string `json:"category_id"`
		SubcategoryID *string `json:"subcategory_id"`
		OccurredAt    string  `json:"occurred_at"`
		Description   string  `json:"description"`
		Source        string  `json:"source"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corpo inválido")
		return
	}
	if body.AmountMinor <= 0 {
		writeError(w, http.StatusBadRequest, "amount_minor > 0")
		return
	}
	dir := domain.Direction(strings.TrimSpace(strings.ToLower(body.Direction)))
	if dir != domain.DirectionIn && dir != domain.DirectionOut {
		writeError(w, http.StatusBadRequest, "direction: in ou out")
		return
	}
	occ, err := time.Parse(time.RFC3339, strings.TrimSpace(body.OccurredAt))
	if err != nil {
		writeError(w, http.StatusBadRequest, "occurred_at RFC3339")
		return
	}
	cur := strings.TrimSpace(body.Currency)
	if cur == "" {
		cur = "EUR"
	}
	src := domain.TxSource(strings.TrimSpace(body.Source))
	if src != domain.TxSourceAgent {
		src = domain.TxSourceManual
	}
	now := time.Now().UTC()
	t := &domain.Transaction{
		ID: uuid.New(), UserID: userID, AmountMinor: body.AmountMinor, Currency: cur,
		Direction: dir, OccurredAt: occ.UTC(), Description: strings.TrimSpace(body.Description),
		Source: src, CreatedAt: now,
	}
	if body.CategoryID != nil && strings.TrimSpace(*body.CategoryID) != "" {
		cid, err := uuid.Parse(strings.TrimSpace(*body.CategoryID))
		if err == nil {
			t.CategoryID = &cid
		}
	}
	if body.SubcategoryID != nil && strings.TrimSpace(*body.SubcategoryID) != "" {
		sid, err := uuid.Parse(strings.TrimSpace(*body.SubcategoryID))
		if err == nil {
			t.SubcategoryID = &sid
		}
	}
	if err := h.Repo.CreateTransaction(r.Context(), t); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, txToJSON(t))
}

func (h *FinanceHandlers) GetTransactions(w http.ResponseWriter, r *http.Request) {
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil || h.Repo == nil {
		return
	}
	fromS := strings.TrimSpace(r.URL.Query().Get("from"))
	toS := strings.TrimSpace(r.URL.Query().Get("to"))
	if fromS == "" || toS == "" {
		writeError(w, http.StatusBadRequest, "from e to obrigatórios")
		return
	}
	from, err := time.Parse(time.RFC3339, fromS)
	if err != nil {
		writeError(w, http.StatusBadRequest, "from inválido")
		return
	}
	to, err := time.Parse(time.RFC3339, toS)
	if err != nil {
		writeError(w, http.StatusBadRequest, "to inválido")
		return
	}
	var dir *domain.Direction
	if d := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("direction"))); d == "in" || d == "out" {
		x := domain.Direction(d)
		dir = &x
	}
	list, err := h.Repo.ListTransactionsByRange(r.Context(), userID, from, to, dir)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "erro ao listar")
		return
	}
	out := make([]any, 0, len(list))
	for i := range list {
		out = append(out, txToJSON(&list[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *FinanceHandlers) DeleteTransaction(w http.ResponseWriter, r *http.Request) {
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil || h.Repo == nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "id inválido")
		return
	}
	if err := h.Repo.DeleteTransaction(r.Context(), id, userID); err != nil {
		writeError(w, http.StatusNotFound, "não encontrado")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// PatchTransaction PATCH /v1/finance/transactions/{id} — category_id, subcategory_id, description (parcial).
func (h *FinanceHandlers) PatchTransaction(w http.ResponseWriter, r *http.Request) {
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil || h.Repo == nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "id inválido")
		return
	}
	var body struct {
		CategoryID    *string `json:"category_id"`
		SubcategoryID *string `json:"subcategory_id"`
		Description   *string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corpo inválido")
		return
	}
	ctx := r.Context()
	tx, err := h.Repo.GetTransaction(ctx, id, userID)
	if err != nil {
		writeError(w, http.StatusNotFound, "não encontrado")
		return
	}
	if body.Description != nil {
		tx.Description = strings.TrimSpace(*body.Description)
	}
	if body.CategoryID != nil {
		raw := strings.TrimSpace(*body.CategoryID)
		if raw == "" {
			tx.CategoryID = nil
		} else {
			cid, err := uuid.Parse(raw)
			if err != nil {
				writeError(w, http.StatusBadRequest, "category_id inválido")
				return
			}
			if _, err := h.Repo.GetCategory(ctx, cid, userID); err != nil {
				writeError(w, http.StatusBadRequest, "categoria inexistente")
				return
			}
			tx.CategoryID = &cid
		}
	}
	if body.SubcategoryID != nil {
		raw := strings.TrimSpace(*body.SubcategoryID)
		if raw == "" {
			tx.SubcategoryID = nil
		} else {
			sid, err := uuid.Parse(raw)
			if err != nil {
				writeError(w, http.StatusBadRequest, "subcategory_id inválido")
				return
			}
			if _, err := h.Repo.GetCategory(ctx, sid, userID); err != nil {
				writeError(w, http.StatusBadRequest, "subcategoria inexistente")
				return
			}
			tx.SubcategoryID = &sid
		}
	}
	if err := h.Repo.UpdateTransaction(ctx, tx); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, txToJSON(tx))
}

func txToJSON(t *domain.Transaction) map[string]any {
	m := map[string]any{
		"id": t.ID.String(), "user_id": t.UserID.String(), "amount_minor": t.AmountMinor,
		"currency": t.Currency, "direction": string(t.Direction), "description": t.Description,
		"source": string(t.Source), "occurred_at": formatTimeUTC(t.OccurredAt), "created_at": formatTimeUTC(t.CreatedAt),
	}
	if t.CategoryID != nil {
		m["category_id"] = t.CategoryID.String()
	}
	if t.SubcategoryID != nil {
		m["subcategory_id"] = t.SubcategoryID.String()
	}
	return m
}

// --- Subscriptions ---

func advanceDue(cad domain.Cadence, from time.Time) time.Time {
	switch cad {
	case domain.CadenceWeekly:
		return from.AddDate(0, 0, 7)
	case domain.CadenceYearly:
		return from.AddDate(1, 0, 0)
	default:
		return from.AddDate(0, 1, 0)
	}
}

func (h *FinanceHandlers) PostSubscription(w http.ResponseWriter, r *http.Request) {
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil || h.Repo == nil {
		return
	}
	var body struct {
		Name        string `json:"name"`
		AmountMinor int64  `json:"amount_minor"`
		Currency    string `json:"currency"`
		Cadence     string `json:"cadence"`
		AnchorDay   *int8  `json:"anchor_day"`
		NextDueAt   string `json:"next_due_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Name) == "" {
		writeError(w, http.StatusBadRequest, "name obrigatório")
		return
	}
	nd, err := time.Parse(time.RFC3339, strings.TrimSpace(body.NextDueAt))
	if err != nil {
		writeError(w, http.StatusBadRequest, "next_due_at RFC3339")
		return
	}
	cad := domain.Cadence(strings.TrimSpace(strings.ToLower(body.Cadence)))
	if cad != domain.CadenceWeekly && cad != domain.CadenceYearly {
		cad = domain.CadenceMonthly
	}
	cur := strings.TrimSpace(body.Currency)
	if cur == "" {
		cur = "EUR"
	}
	now := time.Now().UTC()
	s := &domain.Subscription{
		ID: uuid.New(), UserID: userID, Name: strings.TrimSpace(body.Name),
		AmountMinor: body.AmountMinor, Currency: cur, Cadence: cad, AnchorDay: body.AnchorDay,
		NextDueAt: nd.UTC(), Status: domain.SubActive, CreatedAt: now, UpdatedAt: now,
	}
	if err := h.Repo.CreateSubscription(r.Context(), s); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, subToJSON(s))
}

func (h *FinanceHandlers) GetSubscriptions(w http.ResponseWriter, r *http.Request) {
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil || h.Repo == nil {
		return
	}
	list, err := h.Repo.ListSubscriptionsByUser(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]any, 0, len(list))
	for i := range list {
		out = append(out, subToJSON(&list[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *FinanceHandlers) PatchSubscription(w http.ResponseWriter, r *http.Request) {
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil || h.Repo == nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "id inválido")
		return
	}
	s, err := h.Repo.GetSubscription(r.Context(), id, userID)
	if err != nil {
		writeError(w, http.StatusNotFound, "não encontrado")
		return
	}
	var body struct {
		Name            *string `json:"name"`
		AmountMinor     *int64  `json:"amount_minor"`
		Currency        *string `json:"currency"`
		Cadence         *string `json:"cadence"`
		NextDueAt       *string `json:"next_due_at"`
		Status          *string `json:"status"`
		ReminderActive  *bool   `json:"reminder_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corpo inválido")
		return
	}
	if body.Name != nil {
		s.Name = strings.TrimSpace(*body.Name)
	}
	if body.AmountMinor != nil {
		s.AmountMinor = *body.AmountMinor
	}
	if body.Currency != nil {
		s.Currency = strings.TrimSpace(*body.Currency)
	}
	if body.Cadence != nil {
		c := domain.Cadence(strings.TrimSpace(strings.ToLower(*body.Cadence)))
		if c == domain.CadenceWeekly || c == domain.CadenceMonthly || c == domain.CadenceYearly {
			s.Cadence = c
		}
	}
	if body.NextDueAt != nil {
		t, err := time.Parse(time.RFC3339, strings.TrimSpace(*body.NextDueAt))
		if err == nil {
			s.NextDueAt = t.UTC()
		}
	}
	if body.Status != nil {
		st := domain.SubStatus(strings.TrimSpace(strings.ToLower(*body.Status)))
		if st == domain.SubActive || st == domain.SubPaused {
			s.Status = st
		}
	}
	if body.ReminderActive != nil {
		s.ReminderActive = *body.ReminderActive
	}
	s.UpdatedAt = time.Now().UTC()
	if err := h.Repo.UpdateSubscription(r.Context(), s); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, subToJSON(s))
}

func (h *FinanceHandlers) DeleteSubscription(w http.ResponseWriter, r *http.Request) {
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil || h.Repo == nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "id inválido")
		return
	}
	if err := h.Repo.DeleteSubscription(r.Context(), id, userID); err != nil {
		writeError(w, http.StatusNotFound, "não encontrado")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *FinanceHandlers) PostSubscriptionPaid(w http.ResponseWriter, r *http.Request) {
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil || h.Repo == nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "id inválido")
		return
	}
	s, err := h.Repo.GetSubscription(r.Context(), id, userID)
	if err != nil {
		writeError(w, http.StatusNotFound, "não encontrado")
		return
	}
	now := time.Now().UTC()
	s.LastPaidAt = &now
	s.ReminderActive = false
	s.LastReminderSentAt = nil
	s.NextDueAt = advanceDue(s.Cadence, s.NextDueAt).UTC()
	s.UpdatedAt = now
	if err := h.Repo.UpdateSubscription(r.Context(), s); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, subToJSON(s))
}

func subToJSON(s *domain.Subscription) map[string]any {
	m := map[string]any{
		"id": s.ID.String(), "user_id": s.UserID.String(), "name": s.Name, "amount_minor": s.AmountMinor,
		"currency": s.Currency, "cadence": string(s.Cadence), "next_due_at": formatTimeUTC(s.NextDueAt),
		"status": string(s.Status), "reminder_active": s.ReminderActive,
		"created_at": formatTimeUTC(s.CreatedAt), "updated_at": formatTimeUTC(s.UpdatedAt),
	}
	if s.AnchorDay != nil {
		m["anchor_day"] = int(*s.AnchorDay)
	}
	if s.LastPaidAt != nil {
		m["last_paid_at"] = formatTimeUTC(*s.LastPaidAt)
	}
	if s.LastReminderSentAt != nil {
		m["last_reminder_sent_at"] = s.LastReminderSentAt.UTC().Format("2006-01-02")
	}
	return m
}

// --- Digest settings GET /v1/me/digest-settings PUT ---

func (h *FinanceHandlers) GetDigestSettings(w http.ResponseWriter, r *http.Request) {
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil || h.Repo == nil {
		return
	}
	d, err := h.Repo.GetDigestSettings(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "erro")
		return
	}
	writeJSON(w, http.StatusOK, digestToJSON(d))
}

func (h *FinanceHandlers) PutDigestSettings(w http.ResponseWriter, r *http.Request) {
	userID := mustUserUUID(w, r)
	if userID == uuid.Nil || h.Repo == nil {
		return
	}
	var body struct {
		Timezone              string `json:"timezone"`
		DigestHour            *int   `json:"digest_hour"`
		DigestEnabled         *bool  `json:"digest_enabled"`
		IncludeFinanceSummary *bool  `json:"include_finance_summary"`
		IncludeTasks          *bool  `json:"include_tasks"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corpo inválido")
		return
	}
	cur, err := h.Repo.GetDigestSettings(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "erro")
		return
	}
	if strings.TrimSpace(body.Timezone) != "" {
		cur.Timezone = strings.TrimSpace(body.Timezone)
	}
	if body.DigestHour != nil {
		hh := *body.DigestHour
		if hh >= 0 && hh <= 23 {
			cur.DigestHour = hh
		}
	}
	if body.DigestEnabled != nil {
		cur.DigestEnabled = *body.DigestEnabled
	}
	if body.IncludeFinanceSummary != nil {
		cur.IncludeFinanceSummary = *body.IncludeFinanceSummary
	}
	if body.IncludeTasks != nil {
		cur.IncludeTasks = *body.IncludeTasks
	}
	cur.UpdatedAt = time.Now().UTC()
	if err := h.Repo.UpsertDigestSettings(r.Context(), cur); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, digestToJSON(cur))
}

func digestToJSON(d *domain.DigestSettings) map[string]any {
	m := map[string]any{
		"user_id": d.UserID.String(), "timezone": d.Timezone, "digest_hour": d.DigestHour,
		"digest_enabled": d.DigestEnabled, "include_finance_summary": d.IncludeFinanceSummary,
		"include_tasks": d.IncludeTasks, "updated_at": formatTimeUTC(d.UpdatedAt),
	}
	if d.LastDigestSentOn != nil {
		m["last_digest_sent_on"] = d.LastDigestSentOn.UTC().Format("2006-01-02")
	}
	return m
}
