package httptransport

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	contactsapp "github.com/open-polvo/open-polvo/internal/contacts/application"
)

type ContactHandlers struct {
	List      *contactsapp.ListContacts
	Create    *contactsapp.CreateContact
	Get       *contactsapp.GetContact
	Update    *contactsapp.UpdateContact
	DeleteOne *contactsapp.DeleteContact
}

type contactDTO struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Phone     string `json:"phone"`
	Email     string `json:"email"`
	CreatedAt string `json:"created_at,omitempty"`
	UpdatedAt string `json:"updated_at,omitempty"`
}

func (h *ContactHandlers) GetList(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil || h.List == nil {
		writeError(w, http.StatusNotImplemented, "contacts not configured")
		return
	}
	list, err := h.List.Execute(r.Context(), uid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list contacts")
		return
	}
	out := make([]contactDTO, 0, len(list))
	for _, c := range list {
		out = append(out, contactDTO{
			ID:        c.ID,
			Name:      c.Name,
			Phone:     c.Phone,
			Email:     c.Email,
			CreatedAt: c.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
			UpdatedAt: c.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		})
	}
	writeJSON(w, http.StatusOK, out)
}

type postContactBody struct {
	Name  string `json:"name"`
	Phone string `json:"phone"`
	Email string `json:"email"`
}

func (h *ContactHandlers) Post(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil || h.Create == nil {
		writeError(w, http.StatusNotImplemented, "contacts not configured")
		return
	}
	var body postContactBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	c, err := h.Create.Execute(r.Context(), uid, contactsapp.CreateContactInput{
		Name: body.Name, Phone: body.Phone, Email: body.Email,
	})
	if err != nil {
		msg := err.Error()
		if msg == "nome é obrigatório" || msg == "email é obrigatório" || msg == "email inválido" ||
			msg == "nome demasiado longo" || msg == "telefone demasiado longo" {
			writeError(w, http.StatusBadRequest, msg)
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to create contact")
		return
	}
	writeJSON(w, http.StatusCreated, contactDTO{
		ID: c.ID, Name: c.Name, Phone: c.Phone, Email: c.Email,
		CreatedAt: c.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt: c.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
	})
}

func (h *ContactHandlers) GetOne(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil || h.Get == nil {
		writeError(w, http.StatusNotImplemented, "contacts not configured")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	c, err := h.Get.Execute(r.Context(), uid, id)
	if err != nil {
		if errors.Is(err, contactsapp.ErrContactNotFound) {
			writeError(w, http.StatusNotFound, "contact not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load contact")
		return
	}
	writeJSON(w, http.StatusOK, contactDTO{
		ID: c.ID, Name: c.Name, Phone: c.Phone, Email: c.Email,
		CreatedAt: c.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt: c.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
	})
}

func (h *ContactHandlers) Put(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil || h.Update == nil {
		writeError(w, http.StatusNotImplemented, "contacts not configured")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body postContactBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	err = h.Update.Execute(r.Context(), uid, id, contactsapp.UpdateContactInput{
		Name: body.Name, Phone: body.Phone, Email: body.Email,
	})
	if err != nil {
		if errors.Is(err, contactsapp.ErrContactNotFound) {
			writeError(w, http.StatusNotFound, "contact not found")
			return
		}
		msg := err.Error()
		if msg == "nome é obrigatório" || msg == "email é obrigatório" || msg == "email inválido" ||
			msg == "nome demasiado longo" || msg == "telefone demasiado longo" {
			writeError(w, http.StatusBadRequest, msg)
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to update contact")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *ContactHandlers) Delete(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil || h.DeleteOne == nil {
		writeError(w, http.StatusNotImplemented, "contacts not configured")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	err = h.DeleteOne.Execute(r.Context(), uid, id)
	if err != nil {
		if errors.Is(err, contactsapp.ErrContactNotFound) {
			writeError(w, http.StatusNotFound, "contact not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to delete contact")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
