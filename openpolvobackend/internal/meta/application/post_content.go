package application

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/google/uuid"

	mailcrypto "github.com/open-polvo/open-polvo/internal/mail/crypto"
	"github.com/open-polvo/open-polvo/internal/meta/metaapi"
	"github.com/open-polvo/open-polvo/internal/meta/ports"
	platformcfg "github.com/open-polvo/open-polvo/internal/platform/config"
)

type PostMetaContent struct {
	Repo   ports.MetaSettingsRepository
	Cfg    platformcfg.Config
	Client *metaapi.Client
}

type PostMetaContentInput struct {
	Platform string // "facebook" | "instagram"
	Message  string
	ImageURL string // obrigatório para instagram
}

type PostMetaContentResult struct {
	PostID string `json:"post_id"`
}

func (uc *PostMetaContent) Execute(ctx context.Context, userID uuid.UUID, in PostMetaContentInput) (*PostMetaContentResult, error) {
	key := keyForMetaTokens(uc.Cfg)
	rec, err := uc.Repo.GetByUserID(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errors.New("meta não configurado")
		}
		return nil, err
	}

	var postID string
	switch strings.ToLower(in.Platform) {
	case "facebook":
		if rec.FBPageID == "" || len(rec.FBPageTokenEnc) == 0 {
			return nil, errors.New("página de Facebook não configurada")
		}
		tok, err := mailcrypto.DecryptAES256GCM(rec.FBPageTokenEnc, key)
		if err != nil {
			return nil, errors.New("falha ao ler token Facebook")
		}
		postID, err = uc.Client.PostFacebookPage(ctx, rec.FBPageID, string(tok), in.Message)
		if err != nil {
			return nil, err
		}
	case "instagram":
		if rec.IGAccountID == "" || len(rec.IGAccessTokenEnc) == 0 {
			return nil, errors.New("conta Instagram não configurada")
		}
		tok, err := mailcrypto.DecryptAES256GCM(rec.IGAccessTokenEnc, key)
		if err != nil {
			return nil, errors.New("falha ao ler token Instagram")
		}
		if in.ImageURL != "" {
			postID, err = uc.Client.PostInstagramMedia(ctx, rec.IGAccountID, string(tok), in.ImageURL, in.Message)
		} else {
			postID, err = uc.Client.PostInstagramCaption(ctx, rec.IGAccountID, string(tok), in.Message)
		}
		if err != nil {
			return nil, err
		}
	default:
		return nil, errors.New("plataforma inválida: use 'facebook' ou 'instagram'")
	}
	return &PostMetaContentResult{PostID: postID}, nil
}
