package httptransport

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	platformcfg "github.com/open-polvo/open-polvo/internal/platform/config"
)

type Deps struct {
	Config        platformcfg.Config
	Auth          *AuthHandlers
	Agent         *AgentHandlers
	Conversations *ConversationHandlers
	Workflows     *WorkflowHandlers
	Mail          *MailHandlers
	Contacts      *ContactHandlers
	TokenParser   TokenParser
	ReadyCheck    func(context.Context) error
}

func NewRouter(d Deps) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(6 * time.Minute))

	if len(d.Config.CORSAllowedOrigins) > 0 || d.Config.CORSAllowNullOrigin {
		allowed := make(map[string]struct{}, len(d.Config.CORSAllowedOrigins))
		for _, o := range d.Config.CORSAllowedOrigins {
			allowed[o] = struct{}{}
		}
		r.Use(cors.Handler(cors.Options{
			AllowOriginFunc: func(_ *http.Request, origin string) bool {
				if d.Config.CORSAllowNullOrigin {
					if origin == "" || strings.EqualFold(origin, "null") {
						return true
					}
				}
				_, ok := allowed[origin]
				return ok
			},
			AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
			AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID"},
			AllowCredentials: false,
			MaxAge:           300,
		}))
	}

	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	r.Get("/healthz", d.GetHealthz)
	r.Get("/readyz", d.GetReadyz)

	r.Get("/ready", d.readyHTTP)

	r.Route("/v1", func(r chi.Router) {
		r.Post("/auth/login", d.Auth.PostLogin)
		if d.Auth.AllowRegister {
			r.Post("/auth/register", d.Auth.PostRegister)
		}
		r.Group(func(r chi.Router) {
			r.Use(BearerAuth(d.TokenParser))
			r.Get("/auth/me", d.Auth.GetMe)
			if d.Mail != nil {
				r.Get("/me/smtp", d.Mail.GetMeSMTP)
				r.Put("/me/smtp", d.Mail.PutMeSMTP)
				r.Post("/email/send", d.Mail.PostEmailSend)
			}
			if d.Contacts != nil {
				r.Get("/me/contacts", d.Contacts.GetList)
				r.Post("/me/contacts", d.Contacts.Post)
				r.Get("/me/contacts/{id}", d.Contacts.GetOne)
				r.Put("/me/contacts/{id}", d.Contacts.Put)
				r.Delete("/me/contacts/{id}", d.Contacts.Delete)
			}
			r.Get("/agent/status", d.Agent.GetAgentStatus)
			r.Get("/agent/langgraph/status", d.Agent.GetLangGraphStatus)
			r.Post("/agent/langgraph/threads", d.Agent.PostLangGraphThreads)
			if d.Conversations != nil {
				r.Get("/conversations", d.Conversations.GetConversations)
				r.Post("/conversations", d.Conversations.PostConversation)
				r.Get("/conversations/{id}", d.Conversations.GetConversation)
				r.Patch("/conversations/{id}", d.Conversations.PatchConversationHandler)
				r.Delete("/conversations/{id}", d.Conversations.DeleteConversationHandler)
				r.Post("/conversations/{id}/pin", d.Conversations.PinConversationHandler)
				r.Get("/conversations/{id}/messages", d.Conversations.GetMessages)
				r.Post("/conversations/{id}/messages", d.Conversations.PostMessage)
			}
			if d.Workflows != nil {
				r.Get("/workflows", d.Workflows.GetWorkflows)
				r.Post("/workflows", d.Workflows.PostWorkflow)
				r.Post("/workflows/generate", d.Workflows.PostWorkflowGenerate)
				r.Get("/workflows/{id}", d.Workflows.GetWorkflow)
				r.Patch("/workflows/{id}", d.Workflows.PatchWorkflow)
				r.Delete("/workflows/{id}", d.Workflows.DeleteWorkflow)
				r.Post("/workflows/{id}/pin", d.Workflows.PostWorkflowPin)
				r.Post("/workflows/{id}/run", d.Workflows.PostWorkflowRun)
				r.Get("/workflows/{id}/runs", d.Workflows.GetWorkflowRuns)
			}
		})
	})

	return r
}

func (d Deps) readyHTTP(w http.ResponseWriter, r *http.Request) {
	if d.ReadyCheck == nil {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if err := d.ReadyCheck(ctx); err != nil {
		writeError(w, http.StatusServiceUnavailable, "not ready")
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}
