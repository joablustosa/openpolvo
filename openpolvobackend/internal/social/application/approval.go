package application

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"

	mailcrypto "github.com/open-polvo/open-polvo/internal/mail/crypto"
	"github.com/open-polvo/open-polvo/internal/meta/metaapi"
	metaports "github.com/open-polvo/open-polvo/internal/meta/ports"
	"github.com/open-polvo/open-polvo/internal/social/domain"
	"github.com/open-polvo/open-polvo/internal/social/ports"
	platformcfg "github.com/open-polvo/open-polvo/internal/platform/config"
)

// SendApprovalWhatsApp envia mensagem WhatsApp com preview do post para aprovação.
type SendApprovalWhatsApp struct {
	Posts      ports.SocialPostRepository
	MetaRepo   metaports.MetaSettingsRepository
	MetaClient *metaapi.Client
	Cfg        platformcfg.Config
}

func (uc *SendApprovalWhatsApp) Execute(ctx context.Context, userID uuid.UUID, post *domain.SocialPost, approvalPhone string) error {
	if approvalPhone == "" {
		return errors.New("número de aprovação não configurado")
	}
	key := deriveMetaKey(uc.Cfg)
	rec, err := uc.MetaRepo.GetByUserID(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return errors.New("WhatsApp não configurado")
		}
		return err
	}
	if rec.WAPhoneNumberID == "" || len(rec.WAAccessTokenEnc) == 0 {
		return errors.New("WhatsApp Business não configurado")
	}
	tok, err := mailcrypto.DecryptAES256GCM(rec.WAAccessTokenEnc, key)
	if err != nil {
		return errors.New("falha ao ler token WhatsApp")
	}

	tags := strings.Join(post.Hashtags, " ")
	platform := map[string]string{"facebook": "Facebook", "instagram": "Instagram"}[post.Platform]
	if platform == "" {
		platform = post.Platform
	}

	msg := fmt.Sprintf(
		"🤖 *Open Polvo — Aprovação de Post*\n\n"+
			"📱 *Plataforma:* %s\n"+
			"📌 *Título:* %s\n\n"+
			"📝 *Descrição:*\n%s\n\n"+
			"🏷️ *Hashtags:* %s\n\n"+
			"🆔 ID: `%s`\n\n"+
			"Responda *SIM* para publicar ou *NÃO* para rejeitar.",
		platform, post.Title, post.Description, tags, post.ID,
	)

	_, err = uc.MetaClient.SendWhatsAppText(ctx, rec.WAPhoneNumberID, string(tok), approvalPhone, msg)
	if err != nil {
		return fmt.Errorf("falha ao enviar WhatsApp: %w", err)
	}
	now := time.Now().UTC()
	return uc.Posts.UpdateStatus(ctx, post.ID, domain.StatusPendingApproval, map[string]any{
		"approval_sent_at": now,
	})
}

// HandleWhatsAppReply processa uma resposta de aprovação via WhatsApp.
// userID é o utilizador dono da conta WhatsApp que recebeu o reply.
// text é o corpo da mensagem recebida.
type HandleWhatsAppReply struct {
	Posts     ports.SocialPostRepository
	Publisher *PublishPost
}

type HandleReplyResult struct {
	Action  string // "approved_published" | "rejected" | "ignored"
	PostID  string
}

func (uc *HandleWhatsAppReply) Execute(ctx context.Context, userID uuid.UUID, text string) (*HandleReplyResult, error) {
	clean := strings.ToUpper(strings.TrimFunc(text, func(r rune) bool {
		return unicode.IsSpace(r) || r == '.' || r == '!' || r == '?'
	}))

	// Tenta extrair ID explícito da mensagem (se o utilizador citou o ID)
	var explicitID string
	if idx := strings.Index(strings.ToLower(text), "id:"); idx >= 0 {
		rest := strings.TrimSpace(text[idx+3:])
		if parts := strings.Fields(rest); len(parts) > 0 {
			explicitID = strings.Trim(parts[0], "`")
		}
	}

	isYes := clean == "SIM" || clean == "S" || clean == "YES" || clean == "Y" || strings.HasPrefix(clean, "SIM ")
	isNo := clean == "NÃO" || clean == "NAO" || clean == "N" || clean == "NO" || strings.HasPrefix(clean, "NÃO ") || strings.HasPrefix(clean, "NAO ")

	if !isYes && !isNo {
		return &HandleReplyResult{Action: "ignored"}, nil
	}

	var post *domain.SocialPost
	var err error

	if explicitID != "" {
		post, err = uc.Posts.GetByID(ctx, explicitID)
		if err != nil || post.UserID != userID.String() {
			post = nil
		}
	}
	if post == nil {
		post, err = uc.Posts.GetPendingApprovalByUser(ctx, userID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return &HandleReplyResult{Action: "ignored"}, nil
			}
			return nil, err
		}
	}

	if isYes {
		if err := uc.Publisher.ApprovePost(ctx, userID, post.ID); err != nil {
			return nil, err
		}
		return &HandleReplyResult{Action: "approved_published", PostID: post.ID}, nil
	}
	if err := uc.Publisher.RejectPost(ctx, userID, post.ID); err != nil {
		return nil, err
	}
	return &HandleReplyResult{Action: "rejected", PostID: post.ID}, nil
}
