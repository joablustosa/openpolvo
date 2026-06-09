package domain

import (
	"time"

	"github.com/google/uuid"
)

// Defaults aplicados a um projeto de dev quando o metadata não os especifica.
const (
	DefaultKind  = "app"
	DefaultStack = "vite-react"
)

// Project representa o app/site de dev vinculado a uma conversa do chat.
type Project struct {
	ID               uuid.UUID
	UserID           uuid.UUID
	ConversationID   uuid.UUID
	Title            string
	Kind             string
	Stack            string
	LatestVersionSeq int
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// ProjectVersion é um snapshot imutável dos ficheiros do projeto num dado momento.
type ProjectVersion struct {
	ID        uuid.UUID
	ProjectID uuid.UUID
	Seq       int
	Summary   string
	CreatedAt time.Time
}

// ProjectFile é um ficheiro pertencente a uma versão (caminho relativo + conteúdo).
type ProjectFile struct {
	VersionID uuid.UUID
	Path      string
	Content   string
}
