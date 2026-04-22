package domain

import "time"

// AutomationConfig configuração de automação de postagem por utilizador.
type AutomationConfig struct {
	ID            string
	UserID        string
	Platforms     []string // "facebook", "instagram"
	Sites         []string // URLs de referência
	TimesPerDay   int
	ApprovalPhone string // número WhatsApp para aprovação (E.164 ex: 5511999999999)
	Active        bool
	LastRunAt     *time.Time
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// PostStatus ciclo de vida de um post social.
type PostStatus string

const (
	StatusPendingApproval PostStatus = "pending_approval"
	StatusApproved        PostStatus = "approved"
	StatusRejected        PostStatus = "rejected"
	StatusPublished       PostStatus = "published"
	StatusFailed          PostStatus = "failed"
	StatusGenerating      PostStatus = "generating"
)

// SocialPost post gerado aguardando aprovação ou já publicado.
type SocialPost struct {
	ID              string
	UserID          string
	ConfigID        string
	Platform        string // "facebook" | "instagram"
	Title           string
	Description     string
	Hashtags        []string
	ImageURL        string
	ImagePrompt     string
	SourceURL       string
	SourceTitle     string
	Status          PostStatus
	PublishedPostID string
	ApprovalSentAt  *time.Time
	ApprovedAt      *time.Time
	PublishedAt     *time.Time
	ErrorMsg        string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// FullText devolve texto completo para publicação (descrição + hashtags).
func (p *SocialPost) FullText() string {
	if len(p.Hashtags) == 0 {
		return p.Description
	}
	tags := ""
	for _, h := range p.Hashtags {
		tags += " " + h
	}
	return p.Description + "\n\n" + tags
}
