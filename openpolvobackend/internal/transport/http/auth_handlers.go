package httptransport

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/google/uuid"

	idapp "github.com/open-polvo/open-polvo/internal/identity/application"
	"github.com/open-polvo/open-polvo/internal/identity/domain"
	"github.com/open-polvo/open-polvo/internal/identity/ports"
)

type AuthHandlers struct {
	Login         *idapp.Login
	Register      *idapp.Register
	AllowRegister bool
	Users         ports.UserRepository
	Parser        TokenParser
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int64  `json:"expires_in"`
}

type meResponse struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}

func (h *AuthHandlers) PostLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	res, err := h.Login.Execute(r.Context(), idapp.LoginCommand{
		Email:    req.Email,
		Password: req.Password,
	})
	if err != nil {
		if errors.Is(err, domain.ErrInvalidCredentials) {
			writeError(w, http.StatusUnauthorized, "invalid credentials")
			return
		}
		writeError(w, http.StatusInternalServerError, "login failed")
		return
	}
	writeJSON(w, http.StatusOK, loginResponse{
		AccessToken: res.AccessToken,
		TokenType:   res.TokenType,
		ExpiresIn:   res.ExpiresIn,
	})
}

func (h *AuthHandlers) PostRegister(w http.ResponseWriter, r *http.Request) {
	if !h.AllowRegister {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	res, err := h.Register.Execute(r.Context(), idapp.RegisterCommand{
		Email:    req.Email,
		Password: req.Password,
	})
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrEmailTaken):
			writeError(w, http.StatusConflict, "email already registered")
			return
		case errors.Is(err, domain.ErrWeakPassword), errors.Is(err, domain.ErrInvalidEmail):
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "register failed")
		return
	}
	writeJSON(w, http.StatusCreated, loginResponse{
		AccessToken: res.AccessToken,
		TokenType:   res.TokenType,
		ExpiresIn:   res.ExpiresIn,
	})
}

func (h *AuthHandlers) GetMe(w http.ResponseWriter, r *http.Request) {
	uidStr, _, ok := UserFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	id, err := uuid.Parse(uidStr)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid token subject")
		return
	}
	u, err := h.Users.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, ports.ErrNotFound) {
			writeError(w, http.StatusUnauthorized, "user not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load user")
		return
	}
	writeJSON(w, http.StatusOK, meResponse{ID: u.ID.String(), Email: u.Email})
}
