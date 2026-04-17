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
	TestSMTP   *mailapp.TestSMTPConnection
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
	Host                        string `json:"host"`
	Port                        int    `json:"port"`
	Username                    string `json:"username"`
	Password                    string `json:"password"`
	FromEmail                   string `json:"from_email"`
	FromName                    string `json:"from_name"`
	UseTLS                      *bool  `json:"use_tls"`
	EmailChatSkipConfirmation   *bool  `json:"email_chat_skip_confirmation"`
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
		Host:                      body.Host,
		Port:                      body.Port,
		Username:                  body.Username,
		Password:                  body.Password,
		FromEmail:                 body.FromEmail,
		FromName:                  body.FromName,
		UseTLS:                    useTLS,
		EmailChatSkipConfirmation: body.EmailChatSkipConfirmation,
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

func (h *MailHandlers) PostTestSMTP(w http.ResponseWriter, r *http.Request) {
	uid := mustUserUUID(w, r)
	if uid == uuid.Nil {
		return
	}
	if h.TestSMTP == nil {
		writeError(w, http.StatusNotImplemented, "smtp test not configured")
		return
	}
	if err := h.TestSMTP.Execute(r.Context(), uid); err != nil {
		msg := err.Error()
		if strings.Contains(msg, "smtp não configurado") || strings.Contains(msg, "falha ao ler") {
			writeError(w, http.StatusBadRequest, msg)
			return
		}
		// 503: falha ao contactar SMTP externo (evitar 502 "Bad Gateway", que sugere proxy mal configurado).
		writeError(w, http.StatusServiceUnavailable, "smtp test failed: "+truncateForClientErr(smtpDialErrHint(msg), 400))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
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
		writeError(w, http.StatusServiceUnavailable, "smtp send failed: "+truncateForClientErr(smtpDialErrHint(msg), 400))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
}

func smtpDialErrHint(msg string) string {
	msg = strings.TrimSpace(msg)
	if msg == "" {
		return msg
	}
	l := strings.ToLower(msg)
	if !strings.Contains(l, "smtp dial") && !strings.Contains(l, "smtp tls dial") {
		return msg
	}
	if strings.Contains(l, "i/o timeout") || strings.Contains(l, "timeout") {
		base := " — saída SMTP bloqueada ou inacessível: experimente porta 465 com TLS (ex. Gmail), outra rede (hotspot) ou regra de firewall de saída onde a API corre."
		if smtpDialErrShowsIPv4Addr(msg) {
			return msg + base + " O endereço no erro já é IPv4; SMTP_PREFER_IPV4 na API não altera este caso."
		}
		if strings.Contains(msg, "dial tcp [") {
			return msg + base + " Se falhar só com IPv6, defina SMTP_PREFER_IPV4=true no .env da API."
		}
		return msg + base
	}
	return msg
}

// smtpDialErrShowsIPv4Addr detecta o formato típico do Go "… dial tcp w.x.y.z:porta" (já resolvido para IPv4).
func smtpDialErrShowsIPv4Addr(msg string) bool {
	const p = "dial tcp "
	i := strings.Index(msg, p)
	if i < 0 {
		return false
	}
	rest := msg[i+len(p):]
	j := strings.Index(rest, ":")
	if j <= 0 {
		return false
	}
	host := rest[:j]
	if strings.Contains(host, "[") || strings.Contains(host, "]") {
		return false
	}
	return strings.Count(host, ".") == 3 && !strings.Contains(host, ":")
}
