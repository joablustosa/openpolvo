package application

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/google/uuid"

	agentports "github.com/open-polvo/open-polvo/internal/agent/ports"
	convdomain "github.com/open-polvo/open-polvo/internal/conversations/domain"
	lldomain "github.com/open-polvo/open-polvo/internal/llmprofiles/domain"
	"github.com/open-polvo/open-polvo/internal/llmprofiles/ports"
)

// Resolver preenche ReplyInput com chaves/modelos vindos do SQLite (perfis locais).
type Resolver struct {
	Repo ports.Repository
}

func (z *Resolver) ApplyToReplyInput(
	ctx context.Context,
	repIn *agentports.ReplyInput,
	requested convdomain.ModelProvider,
	explicitProfileID *uuid.UUID,
) error {
	if z == nil || z.Repo == nil || repIn == nil {
		return nil
	}
	repIn.OpenAIAPIKey = ""
	repIn.GoogleAPIKey = ""
	repIn.OpenAIModel = ""
	repIn.GoogleModel = ""

	var prof *lldomain.Profile
	var err error

	if explicitProfileID != nil {
		prof, err = z.Repo.GetProfileByID(ctx, *explicitProfileID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrProfileNotFound
			}
			return err
		}
		if strings.TrimSpace(prof.APIKeyPlain) == "" {
			return ErrProfileNotFound
		}
	} else if requested == convdomain.ModelAuto {
		prefs, perr := z.Repo.GetAgentPrefs(ctx)
		if perr == nil && prefs.AgentMode == "profile" && prefs.DefaultProfileID != nil {
			prof, err = z.Repo.GetProfileByID(ctx, *prefs.DefaultProfileID)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
		}
		if prof == nil {
			prof, err = z.Repo.FirstProfileWithKey(ctx)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
		}
	} else if requested == convdomain.ModelOpenAI || requested == convdomain.ModelGoogle {
		prof, err = z.Repo.FirstProfileForProvider(ctx, string(requested))
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
	}

	if prof == nil {
		// Sem perfil na BD: mantém fornecedor pedido (Python usa .env) ou fallback openai para "auto".
		if requested == convdomain.ModelAuto {
			repIn.ModelProvider = convdomain.ModelOpenAI
		} else if requested != "" {
			repIn.ModelProvider = requested
		}
		return nil
	}

	if prof.APIKeyPlain == "" {
		if requested == convdomain.ModelAuto {
			repIn.ModelProvider = convdomain.ModelOpenAI
		} else if requested != "" {
			repIn.ModelProvider = requested
		}
		return nil
	}

	switch prof.Provider {
	case "openai":
		repIn.ModelProvider = convdomain.ModelOpenAI
		repIn.OpenAIAPIKey = prof.APIKeyPlain
		repIn.OpenAIModel = prof.ModelID
	case "google":
		repIn.ModelProvider = convdomain.ModelGoogle
		repIn.GoogleAPIKey = prof.APIKeyPlain
		repIn.GoogleModel = prof.ModelID
	default:
		repIn.ModelProvider = convdomain.ModelOpenAI
	}
	return nil
}
