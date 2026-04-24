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
	// LocalCaps devolve se há perfis LLM na BD SQLite com chave por fornecedor (opcional).
	LocalCaps func(ctx context.Context) (openai bool, google bool)
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
	o := cap.OpenAIConfigured
	g := cap.GoogleConfigured
	if c.LocalCaps != nil {
		lo, lg := c.LocalCaps(ctx)
		o = o || lo
		g = g || lg
	}
	ok := o || g
	return AgentStatus{
		OK:               ok,
		OpenAIConfigured: o,
		GoogleConfigured: g,
	}
}
