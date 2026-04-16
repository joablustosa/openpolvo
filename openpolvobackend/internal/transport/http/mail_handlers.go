package httptransport

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"

	contactsapp "github.com/open-polvo/open-polvo/internal/contacts/application"
	mailapp "github.com/open-polvo/open-polvo/internal/mail/application"
)

type MailHandlers struct {
	GetSMTP    *mailapp.GetMySMTP
	PutSMTP    *mailapp.PutMySMTP
	Send       *mailapp.SendUserEmail
	GetContact *contactsapp.GetContact
}

func (h *MailHandlers) GetMeSMTP(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	if h.GetSMTP == nil {
		writeError(w, http.StatusNotImplemented, "smtp not configured")
		return
	}
	dto, err := h.GetSMTP.Execute(r.Context(), uid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load smtp settings")
		return
	}
	writeJSON(w, http.StatusOK, dto)
}

type putSMTPBody struct {
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	FromEmail string `json:"from_email"`
	FromName  string `json:"from_name"`
	UseTLS    *bool  `json:"use_tls"`
}

func (h *MailHandlers) PutMeSMTP(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	if h.PutSMTP == nil {
		writeError(w, http.StatusNotImplemented, "smtp not configured")
		return
	}
	var body putSMTPBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	useTLS := true
	if body.UseTLS != nil {
		useTLS = *body.UseTLS
	}
	err := h.PutSMTP.Execute(r.Context(), uid, mailapp.PutMySMTPInput{
		Host:      body.Host,
		Port:      body.Port,
		Username:  body.Username,
		Password:  body.Password,
		FromEmail: body.FromEmail,
		FromName:  body.FromName,
		UseTLS:    useTLS,
	})
	if err != nil {
		msg := strings.TrimSpace(err.Error())
		if strings.Contains(msg, "obrigat") || strings.Contains(msg, "inválid") {
			writeError(w, http.StatusBadRequest, msg)
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to save smtp settings")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

type postEmailSendBody struct {
	To         string `json:"to"`
	Subject    string `json:"subject"`
	Body       string `json:"body"`
	ContactID  string `json:"contact_id,omitempty"`
}

func (h *MailHandlers) PostEmailSend(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	if h.Send == nil {
		writeError(w, http.StatusNotImplemented, "email send not configured")
		return
	}
	var body postEmailSendBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	to := strings.TrimSpace(body.To)
	if cid := strings.TrimSpace(body.ContactID); cid != "" {
		if h.GetContact == nil {
			writeError(w, http.StatusBadRequest, "contact_id não suportado")
			return
		}
		parsed, perr := uuid.Parse(cid)
		if perr != nil {
			writeError(w, http.StatusBadRequest, "contact_id inválido")
			return
		}
		c, gerr := h.GetContact.Execute(r.Context(), uid, parsed)
		if gerr != nil {
			if errors.Is(gerr, contactsapp.ErrContactNotFound) {
				writeError(w, http.StatusNotFound, "contacto não encontrado")
				return
			}
			writeError(w, http.StatusInternalServerError, "failed to resolve contact")
			return
		}
		to = strings.TrimSpace(c.Email)
	}
	err := h.Send.Execute(r.Context(), uid, mailapp.SendUserEmailInput{
		To:      to,
		Subject: body.Subject,
		Body:    body.Body,
	})
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "smtp não configurado") {
			writeError(w, http.StatusBadRequest, msg)
			return
		}
		if strings.Contains(msg, "obrigatório") || strings.Contains(msg, "smtp não") || strings.Contains(msg, "falha ao ler") {
			writeError(w, http.StatusBadRequest, msg)
			return
		}
		writeError(w, http.StatusBadGateway, "smtp send failed: "+truncateForClientErr(msg, 200))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
}
