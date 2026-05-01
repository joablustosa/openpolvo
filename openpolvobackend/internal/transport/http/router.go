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
	Config         platformcfg.Config
	Auth           *AuthHandlers
	Agent          *AgentHandlers
	LLM            *LLMHandlers
	Conversations  *ConversationHandlers
	Workflows      *WorkflowHandlers
	TaskLists      *TaskListHandlers
	Mail           *MailHandlers
	Contacts       *ContactHandlers
	Finance        *FinanceHandlers
	Audio          *AudioHandlers
	Meta           *MetaHandlers
	Social         *SocialHandlers
	Schedule       *ScheduleHandlers
	TokenParser    TokenParser
	ReadyCheck     func(context.Context) error
}

func NewRouter(d Deps) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)

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

	// Webhook Meta — público (sem autenticação), fora do grupo /v1 autenticado.
	if d.Meta != nil {
		r.Get("/meta/webhook", d.Meta.GetMetaWebhook)
		r.Post("/meta/webhook", d.Meta.PostMetaWebhook)
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

		// Rotas SSE — sem middleware de timeout (streams longos do Builder).
		r.Group(func(r chi.Router) {
			r.Use(BearerAuth(d.TokenParser))
			if d.Conversations != nil {
				r.Post("/conversations/{id}/messages/stream", d.Conversations.StreamMessage)
			}
			if d.Audio != nil {
				r.Post("/audio/transcribe", d.Audio.PostTranscribe)
			}
		})

		r.Group(func(r chi.Router) {
			r.Use(middleware.Timeout(6 * time.Minute))
			r.Use(BearerAuth(d.TokenParser))
			r.Get("/auth/me", d.Auth.GetMe)
			if d.Mail != nil {
				r.Get("/me/smtp", d.Mail.GetMeSMTP)
				r.Put("/me/smtp", d.Mail.PutMeSMTP)
				r.Post("/me/smtp/test", d.Mail.PostTestSMTP)
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
			if d.LLM != nil {
				r.Get("/llm/profiles", d.LLM.ListProfiles)
				r.Post("/llm/profiles", d.LLM.PostProfile)
				r.Patch("/llm/profiles/{id}", d.LLM.PatchProfile)
				r.Delete("/llm/profiles/{id}", d.LLM.DeleteProfile)
				r.Get("/llm/agent-prefs", d.LLM.GetAgentPrefs)
				r.Put("/llm/agent-prefs", d.LLM.PutAgentPrefs)
			}
			if d.Conversations != nil {
				r.Get("/conversations", d.Conversations.GetConversations)
				r.Post("/conversations", d.Conversations.PostConversation)
				r.Get("/conversations/{id}", d.Conversations.GetConversation)
				r.Patch("/conversations/{id}", d.Conversations.PatchConversationHandler)
				r.Delete("/conversations/{id}", d.Conversations.DeleteConversationHandler)
				r.Post("/conversations/{id}/pin", d.Conversations.PinConversationHandler)
				r.Get("/conversations/{id}/messages", d.Conversations.GetMessages)
				r.Post("/conversations/{id}/messages", d.Conversations.PostMessage)
				r.Get("/conversations/{id}/agent-memory", d.Conversations.GetAgentMemory)
				r.Patch("/conversations/{id}/agent-memory", d.Conversations.PatchAgentMemory)
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
			if d.TaskLists != nil {
				r.Post("/task-lists", d.TaskLists.PostTaskList)
				r.Post("/task-lists/batch", d.TaskLists.PostTaskListBatch)
				r.Get("/task-lists", d.TaskLists.GetTaskLists)
				r.Get("/task-lists/{id}", d.TaskLists.GetTaskList)
				r.Patch("/task-lists/{id}", d.TaskLists.PatchTaskList)
				r.Delete("/task-lists/{id}", d.TaskLists.DeleteTaskList)
				r.Post("/task-lists/{id}/run", d.TaskLists.PostTaskListRun)
				r.Post("/task-lists/{id}/items", d.TaskLists.PostTaskListItems)
				r.Patch("/task-lists/{id}/items/{itemID}", d.TaskLists.PatchTaskListItem)
				r.Delete("/task-lists/{id}/items/{itemID}", d.TaskLists.DeleteTaskListItem)
			}
			if d.Meta != nil {
				r.Get("/me/meta", d.Meta.GetMeMeta)
				r.Put("/me/meta", d.Meta.PutMeMeta)
				r.Post("/me/meta/test", d.Meta.PostTestMeta)
				r.Post("/meta/content", d.Meta.PostMetaContent)
				r.Post("/meta/message", d.Meta.PostMetaSendMessage)
			}
			if d.Social != nil {
				r.Get("/social/config", d.Social.GetSocialConfig)
				r.Put("/social/config", d.Social.PutSocialConfig)
				r.Post("/social/generate", d.Social.PostGenerateNow)
				r.Get("/social/posts", d.Social.GetSocialPosts)
				r.Post("/social/posts/{id}/approve", d.Social.PostApprovePost)
				r.Post("/social/posts/{id}/reject", d.Social.PostRejectPost)
			}
			if d.Schedule != nil {
				r.Get("/scheduled-tasks", d.Schedule.GetList)
				r.Post("/scheduled-tasks", d.Schedule.Post)
				r.Get("/scheduled-tasks/{id}", d.Schedule.GetOne)
				r.Put("/scheduled-tasks/{id}", d.Schedule.Put)
				r.Delete("/scheduled-tasks/{id}", d.Schedule.DeleteOne)
				r.Post("/scheduled-tasks/{id}/run-now", d.Schedule.RunNow)
			}
			if d.Finance != nil {
				r.Get("/agenda", d.Finance.GetAgenda)
				r.Get("/me/digest-settings", d.Finance.GetDigestSettings)
				r.Put("/me/digest-settings", d.Finance.PutDigestSettings)
				r.Route("/finance", func(r chi.Router) {
					r.Post("/categories", d.Finance.PostCategory)
					r.Get("/categories", d.Finance.GetCategories)
					r.Patch("/categories/{id}", d.Finance.PatchCategory)
					r.Delete("/categories/{id}", d.Finance.DeleteCategory)
					r.Post("/transactions", d.Finance.PostTransaction)
					r.Get("/transactions", d.Finance.GetTransactions)
					r.Patch("/transactions/{id}", d.Finance.PatchTransaction)
					r.Delete("/transactions/{id}", d.Finance.DeleteTransaction)
					r.Post("/subscriptions", d.Finance.PostSubscription)
					r.Get("/subscriptions", d.Finance.GetSubscriptions)
					r.Patch("/subscriptions/{id}", d.Finance.PatchSubscription)
					r.Delete("/subscriptions/{id}", d.Finance.DeleteSubscription)
					r.Post("/subscriptions/{id}/paid", d.Finance.PostSubscriptionPaid)
				})
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
