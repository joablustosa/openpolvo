package httptransport

import (
	"net/http"
	"strings"

	"github.com/google/uuid"
)

type TokenParser interface {
	ParseAccessToken(token string) (uuid.UUID, string, error)
}

func BearerAuth(parser TokenParser) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Preflight CORS sem Authorization não deve falhar aqui (go-chi/cors intercepta a maioria;
			// isto cobre OPTIONS soltos ou CORS desligado em alguns ambientes).
			if r.Method == http.MethodOptions {
				next.ServeHTTP(w, r)
				return
			}
			raw := r.Header.Get("Authorization")
			if raw == "" || !strings.HasPrefix(strings.ToLower(raw), "bearer ") {
				writeError(w, http.StatusUnauthorized, "missing bearer token")
				return
			}
			tok := strings.TrimSpace(raw[7:])
			if tok == "" {
				writeError(w, http.StatusUnauthorized, "missing bearer token")
				return
			}
			uid, email, err := parser.ParseAccessToken(tok)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "invalid token")
				return
			}
			ctx := WithUser(r.Context(), uid.String(), email)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func ensureJSON(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
}
