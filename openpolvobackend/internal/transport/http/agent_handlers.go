package httptransport

import (
	"encoding/json"
	"net/http"

	agapp "github.com/open-polvo/open-polvo/internal/agent/application"
)

type AgentHandlers struct {
	Status       *agapp.CheckAgentStatus
	CreateThread *agapp.CreateLocalThread
}

type agentStatusResponse struct {
	OK               bool   `json:"ok"`
	Engine           string `json:"engine"`
	OpenAIConfigured bool   `json:"openai_configured"`
	GoogleConfigured bool   `json:"google_configured"`
	// Campos legados (clientes antigos que esperavam LangGraph):
	LangGraphConfigured bool `json:"langgraph_configured"`
	BaseURLConfigured   bool `json:"base_url_configured"`
	Reachable           bool `json:"reachable"`
}

type createThreadRequest struct {
	AssistantID string `json:"assistant_id,omitempty"`
}

type createThreadResponse struct {
	ThreadID string `json:"thread_id"`
	Local    bool   `json:"local"`
}

func (h *AgentHandlers) GetAgentStatus(w http.ResponseWriter, r *http.Request) {
	st := h.Status.Execute(r.Context())
	ok := st.OK
	engine := "polvo-intelligence-python"
	if !ok {
		engine = "unavailable"
	}
	writeJSON(w, http.StatusOK, agentStatusResponse{
		OK:                  ok,
		Engine:              engine,
		OpenAIConfigured:    st.OpenAIConfigured,
		GoogleConfigured:    st.GoogleConfigured,
		LangGraphConfigured: ok,
		BaseURLConfigured:   ok,
		Reachable:           ok,
	})
}

// GetLangGraphStatus mantém compatibilidade com o path antigo; delega para GetAgentStatus.
func (h *AgentHandlers) GetLangGraphStatus(w http.ResponseWriter, r *http.Request) {
	h.GetAgentStatus(w, r)
}

func (h *AgentHandlers) PostLangGraphThreads(w http.ResponseWriter, r *http.Request) {
	var req createThreadRequest
	_ = json.NewDecoder(r.Body).Decode(&req)
	if h.CreateThread == nil {
		writeError(w, http.StatusNotImplemented, "threads endpoint not available")
		return
	}
	id, err := h.CreateThread.Execute(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create local thread id")
		return
	}
	writeJSON(w, http.StatusCreated, createThreadResponse{ThreadID: id, Local: true})
}
