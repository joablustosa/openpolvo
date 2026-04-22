package application

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	mailcrypto "github.com/open-polvo/open-polvo/internal/mail/crypto"
	"github.com/open-polvo/open-polvo/internal/meta/metaapi"
	metaports "github.com/open-polvo/open-polvo/internal/meta/ports"
	"github.com/open-polvo/open-polvo/internal/social/domain"
	"github.com/open-polvo/open-polvo/internal/social/ports"
	platformcfg "github.com/open-polvo/open-polvo/internal/platform/config"
)

// PublishPost publica um post aprovado na plataforma configurada.
type PublishPost struct {
	Posts      ports.SocialPostRepository
	MetaRepo   metaports.MetaSettingsRepository
	MetaClient *metaapi.Client
	Cfg        platformcfg.Config
}

func (uc *PublishPost) Execute(ctx context.Context, userID uuid.UUID, postID string) error {
	post, err := uc.Posts.GetByID(ctx, postID)
	if err != nil {
		return err
	}
	if post.UserID != userID.String() {
		return errors.New("post não encontrado")
	}
	if post.Status != domain.StatusApproved && post.Status != domain.StatusPendingApproval {
		return errors.New("post não está aprovado para publicação")
	}

	key := deriveMetaKey(uc.Cfg)
	rec, err := uc.MetaRepo.GetByUserID(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return errors.New("integração Meta não configurada")
		}
		return err
	}

	var publishedID string
	switch post.Platform {
	case "facebook":
		if rec.FBPageID == "" || len(rec.FBPageTokenEnc) == 0 {
			return errors.New("página de Facebook não configurada")
		}
		tok, err := mailcrypto.DecryptAES256GCM(rec.FBPageTokenEnc, key)
		if err != nil {
			return errors.New("falha ao ler token Facebook")
		}
		publishedID, err = uc.MetaClient.PostFacebookPage(ctx, rec.FBPageID, string(tok), post.FullText())
		if err != nil {
			_ = uc.Posts.UpdateStatus(ctx, postID, domain.StatusFailed, map[string]any{"error_msg": err.Error()})
			return err
		}
	case "instagram":
		if rec.IGAccountID == "" || len(rec.IGAccessTokenEnc) == 0 {
			return errors.New("conta Instagram não configurada")
		}
		tok, err := mailcrypto.DecryptAES256GCM(rec.IGAccessTokenEnc, key)
		if err != nil {
			return errors.New("falha ao ler token Instagram")
		}
		if post.ImageURL != "" {
			publishedID, err = uc.MetaClient.PostInstagramMedia(ctx, rec.IGAccountID, string(tok), post.ImageURL, post.FullText())
		} else if rec.FBPageID != "" && len(rec.FBPageTokenEnc) > 0 {
			// Sem imagem: fallback para Facebook.
			fbTok, _ := mailcrypto.DecryptAES256GCM(rec.FBPageTokenEnc, key)
			publishedID, err = uc.MetaClient.PostFacebookPage(ctx, rec.FBPageID, string(fbTok), post.FullText())
		} else {
			return errors.New("Instagram requer imagem; sem página Facebook como fallback")
		}
		if err != nil {
			_ = uc.Posts.UpdateStatus(ctx, postID, domain.StatusFailed, map[string]any{"error_msg": err.Error()})
			return err
		}
	default:
		return errors.New("plataforma inválida")
	}

	now := time.Now().UTC()
	return uc.Posts.UpdateStatus(ctx, postID, domain.StatusPublished, map[string]any{
		"published_post_id": publishedID,
		"published_at":      now,
	})
}

// ApprovePost marca post como aprovado e publica imediatamente.
func (uc *PublishPost) ApprovePost(ctx context.Context, userID uuid.UUID, postID string) error {
	post, err := uc.Posts.GetByID(ctx, postID)
	if err != nil {
		return err
	}
	if post.UserID != userID.String() {
		return errors.New("post não encontrado")
	}
	now := time.Now().UTC()
	if err := uc.Posts.UpdateStatus(ctx, postID, domain.StatusApproved, map[string]any{"approved_at": now}); err != nil {
		return err
	}
	return uc.Execute(ctx, userID, postID)
}

// RejectPost marca post como rejeitado.
func (uc *PublishPost) RejectPost(ctx context.Context, userID uuid.UUID, postID string) error {
	post, err := uc.Posts.GetByID(ctx, postID)
	if err != nil {
		return err
	}
	if post.UserID != userID.String() {
		return errors.New("post não encontrado")
	}
	return uc.Posts.UpdateStatus(ctx, postID, domain.StatusRejected, nil)
}

// deriveMetaKey deriva a chave AES-256 para tokens Meta.
func deriveMetaKey(cfg platformcfg.Config) []byte {
	src := "open-polvo:laele:meta:v1:" + cfg.JWTSecret
	if k := strings.TrimSpace(cfg.MetaCredentialsKey); k != "" {
		src = k
	}
	sum := sha256.Sum256([]byte(src))
	return sum[:]
}
