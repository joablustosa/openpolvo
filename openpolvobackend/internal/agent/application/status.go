package application

import (
	"context"

	"github.com/open-polvo/open-polvo/internal/agent/adapters/polvointel"
)

// AgentStatus resume se o serviço Python (Open Polvo Intelligence) está acessível e com chaves LLM.
type AgentStatus struct {
	OK               bool
	OpenAIConfigured bool
	GoogleConfigured bool
}

// CheckAgentStatus consulta /readyz e /v1/capabilities no serviço Intelligence.
type CheckAgentStatus struct {
	Client *polvointel.Client
}

func (c *CheckAgentStatus) Execute(ctx context.Context) AgentStatus {
	if c == nil || c.Client == nil || !c.Client.Configured() {
		return AgentStatus{}
	}
	if err := c.Client.Readyz(ctx); err != nil {
		return AgentStatus{}
	}
	cap, err := c.Client.Capabilities(ctx)
	if err != nil {
		return AgentStatus{}
	}
	ok := cap.OpenAIConfigured || cap.GoogleConfigured
	return AgentStatus{
		OK:               ok,
		OpenAIConfigured: cap.OpenAIConfigured,
		GoogleConfigured: cap.GoogleConfigured,
	}
}
