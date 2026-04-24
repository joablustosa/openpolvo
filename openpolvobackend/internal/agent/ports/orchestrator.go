package ports

import (
	"context"
	"io"

	"github.com/open-polvo/open-polvo/internal/conversations/domain"
)

// AgentMemoryIn memória híbrida por conversa (texto curto para o prompt do Intelligence).
type AgentMemoryIn struct {
	Global  string
	Builder string
}

// ReplyInput contém o histórico já persistido (incluindo a última mensagem do utilizador).
type ReplyInput struct {
	Messages        []domain.Message
	ModelProvider   domain.ModelProvider
	ConversationID  string            // opcional: UUID da conversa para o Intelligence
	AgentMemory     *AgentMemoryIn    // opcional: vindo do SQLite
	// Overrides opcionais enviados ao Open Polvo Intelligence (perfis LLM na BD local).
	OpenAIAPIKey  string `json:"-"`
	GoogleAPIKey  string `json:"-"`
	OpenAIModel   string `json:"-"`
	GoogleModel   string `json:"-"`
	SMTP           *SMTPContext         // opcional: conta de envio configurada na aplicação
	Contacts       []ContactBrief       // opcional: agenda do utilizador (nome, email, telefone)
	TaskLists      []TaskListBrief      // opcional: listas de tarefas persistidas (Agente Tarefas)
	Finance        *FinanceContext       // opcional: finanças pessoais
	Meta           *MetaContext          // opcional: integração Meta (WhatsApp, Facebook, Instagram)
	ScheduledTasks []ScheduledTaskBrief // opcional: automações agendadas do utilizador
}

// ChatOrchestrator implementa o fluxo analisador → router → especialista (Zé Polvinho).
type ChatOrchestrator interface {
	Reply(ctx context.Context, in ReplyInput) (assistantText string, meta map[string]any, err error)
}

// ChatStreamer abre uma ligação SSE ao serviço Python e devolve o corpo da
// resposta para proxy ao browser. O caller fecha o ReadCloser.
type ChatStreamer interface {
	ReplyStream(ctx context.Context, in ReplyInput) (io.ReadCloser, error)
}
