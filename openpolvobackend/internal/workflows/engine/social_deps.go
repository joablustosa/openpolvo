package engine

import "context"

// SocialDeps publicação Meta (Facebook/Instagram), WhatsApp e rascunhos LLM para outras redes.
// Campos opcionais: se nil, nós `post_*` falham com mensagem clara.
type SocialDeps struct {
	PostMeta func(ctx context.Context, platform string, message string, imageURL string) (postID string, err error)
	SendWA   func(ctx context.Context, to string, text string) (msgID string, err error)
}
