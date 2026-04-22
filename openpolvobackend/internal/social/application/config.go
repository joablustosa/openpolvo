package application

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/social/domain"
	"github.com/open-polvo/open-polvo/internal/social/ports"
)

type GetSocialConfig struct {
	Repo ports.AutomationConfigRepository
}

type SocialConfigDTO struct {
	ID            string   `json:"id"`
	Platforms     []string `json:"platforms"`
	Sites         []string `json:"sites"`
	TimesPerDay   int      `json:"times_per_day"`
	ApprovalPhone string   `json:"approval_phone"`
	Active        bool     `json:"active"`
	LastRunAt     *string  `json:"last_run_at,omitempty"`
	UpdatedAtISO  string   `json:"updated_at,omitempty"`
}

func (uc *GetSocialConfig) Execute(ctx context.Context, userID uuid.UUID) (*SocialConfigDTO, error) {
	cfg, err := uc.Repo.GetByUserID(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return &SocialConfigDTO{
				Platforms:   []string{"facebook"},
				Sites:       []string{},
				TimesPerDay: 1,
				Active:      false,
			}, nil
		}
		return nil, err
	}
	dto := &SocialConfigDTO{
		ID:            cfg.ID,
		Platforms:     cfg.Platforms,
		Sites:         cfg.Sites,
		TimesPerDay:   cfg.TimesPerDay,
		ApprovalPhone: cfg.ApprovalPhone,
		Active:        cfg.Active,
		UpdatedAtISO:  cfg.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z07:00"),
	}
	if cfg.LastRunAt != nil {
		s := cfg.LastRunAt.UTC().Format("2006-01-02T15:04:05.000Z07:00")
		dto.LastRunAt = &s
	}
	return dto, nil
}

type PutSocialConfig struct {
	Repo ports.AutomationConfigRepository
}

type PutSocialConfigInput struct {
	Platforms     []string
	Sites         []string
	TimesPerDay   int
	ApprovalPhone string
	Active        bool
}

func (uc *PutSocialConfig) Execute(ctx context.Context, userID uuid.UUID, in PutSocialConfigInput) error {
	if in.TimesPerDay < 1 {
		in.TimesPerDay = 1
	}
	if in.TimesPerDay > 24 {
		in.TimesPerDay = 24
	}
	if len(in.Platforms) == 0 {
		return errors.New("pelo menos uma plataforma obrigatória")
	}
	for _, p := range in.Platforms {
		if p != "facebook" && p != "instagram" {
			return errors.New("plataforma inválida: use 'facebook' ou 'instagram'")
		}
	}
	phone := strings.TrimSpace(in.ApprovalPhone)

	// Tenta carregar config existente para manter o ID.
	existing, err := uc.Repo.GetByUserID(ctx, userID)
	id := uuid.NewString()
	if err == nil {
		id = existing.ID
	}

	cfg := &domain.AutomationConfig{
		ID:            id,
		UserID:        userID.String(),
		Platforms:     in.Platforms,
		Sites:         in.Sites,
		TimesPerDay:   in.TimesPerDay,
		ApprovalPhone: phone,
		Active:        in.Active,
		UpdatedAt:     time.Now().UTC(),
	}
	if err == nil && existing.LastRunAt != nil {
		cfg.LastRunAt = existing.LastRunAt
	}
	return uc.Repo.Upsert(ctx, cfg)
}
