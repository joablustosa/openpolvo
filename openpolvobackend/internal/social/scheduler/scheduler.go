package scheduler

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/social/application"
	"github.com/open-polvo/open-polvo/internal/social/ports"
)

// Runner verifica periodicamente as configurações activas e gera posts quando necessário.
type Runner struct {
	Configs    ports.AutomationConfigRepository
	Generator  *application.GenerateAndStore
	Approval   *application.SendApprovalWhatsApp
	ModelProvider string
	Log        *slog.Logger
}

// Start arranca o scheduler e bloqueia até o contexto ser cancelado.
func (r *Runner) Start(ctx context.Context, checkInterval time.Duration) {
	if checkInterval <= 0 {
		checkInterval = 15 * time.Minute
	}
	r.Log.Info("social scheduler iniciado", "interval", checkInterval)
	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			r.Log.Info("social scheduler terminado")
			return
		case <-ticker.C:
			r.runOnce(ctx)
		}
	}
}

func (r *Runner) runOnce(ctx context.Context) {
	configs, err := r.Configs.ListActive(ctx)
	if err != nil {
		r.Log.Error("social scheduler: listar configs", "err", err)
		return
	}
	now := time.Now().UTC()
	for _, cfg := range configs {
		if len(cfg.Sites) == 0 || len(cfg.Platforms) == 0 {
			continue
		}
		intervalHours := 24.0 / float64(max(cfg.TimesPerDay, 1))
		interval := time.Duration(intervalHours * float64(time.Hour))
		if cfg.LastRunAt != nil && now.Sub(*cfg.LastRunAt) < interval {
			continue
		}

		for _, platform := range cfg.Platforms {
			r.generateForConfig(ctx, cfg.ID, cfg.UserID, platform, cfg.Sites, cfg.ApprovalPhone)
		}
		_ = r.Configs.TouchLastRun(ctx, cfg.ID, now)
	}
}

func (r *Runner) generateForConfig(ctx context.Context, configID, userIDStr, platform string, sites []string, approvalPhone string) {
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		r.Log.Error("social scheduler: parse user id", "err", err)
		return
	}
	genCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()

	provider := r.ModelProvider
	if provider == "" {
		provider = "openai"
	}

	r.Log.Info("social scheduler: gerando post", "user", userIDStr, "platform", platform)
	post, err := r.Generator.Execute(genCtx, application.GenerateInput{
		UserID:   userID,
		ConfigID: configID,
		Platform: platform,
		Sites:    sites,
		Provider: provider,
	})
	if err != nil {
		r.Log.Error("social scheduler: gerar post", "err", err, "user", userIDStr)
		return
	}

	if approvalPhone == "" {
		r.Log.Warn("social scheduler: sem número de aprovação, post pendente sem notificação", "post", post.ID)
		return
	}

	approvalCtx, aCancel := context.WithTimeout(ctx, 30*time.Second)
	defer aCancel()
	if err := r.Approval.Execute(approvalCtx, userID, post, approvalPhone); err != nil {
		r.Log.Error("social scheduler: enviar aprovação WhatsApp", "err", err, "post", post.ID)
	}
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
