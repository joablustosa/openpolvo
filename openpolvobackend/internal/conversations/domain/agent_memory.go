package domain

// AgentMemory texto curto persistido por conversa (escopo geral + notas do Builder).
type AgentMemory struct {
	Global  string
	Builder string
}
