package application

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/conversations/domain"
	wfdomain "github.com/open-polvo/open-polvo/internal/workflows/domain"
	wfports "github.com/open-polvo/open-polvo/internal/workflows/ports"
)

type GenerateWorkflow struct {
	LLM wfports.IntelligenceService
}

func (uc *GenerateWorkflow) Execute(ctx context.Context, provider domain.ModelProvider, userRequest, recordingJSON string) (wfdomain.GraphJSON, string, error) {
	if uc.LLM == nil {
		return wfdomain.GraphJSON{}, "", ErrLLMNotConfigured
	}
	raw, err := uc.LLM.GenerateGraphJSON(ctx, provider, userRequest, recordingJSON)
	if err != nil {
		return wfdomain.GraphJSON{}, "", err
	}
	clean := strings.TrimSpace(raw)
	clean = strings.TrimPrefix(clean, "```json")
	clean = strings.TrimPrefix(clean, "```")
	clean = strings.TrimSuffix(clean, "```")
	clean = strings.TrimSpace(clean)

	var g wfdomain.GraphJSON
	if err := json.Unmarshal([]byte(clean), &g); err != nil {
		return wfdomain.GraphJSON{}, raw, err
	}
	return g, raw, nil
}

type SaveGeneratedWorkflow struct {
	Create *CreateWorkflow
}

func (uc *SaveGeneratedWorkflow) Execute(ctx context.Context, userID uuid.UUID, title string, g wfdomain.GraphJSON) (*wfdomain.Workflow, error) {
	if uc.Create == nil {
		return nil, ErrLLMNotConfigured
	}
	return uc.Create.Execute(ctx, userID, title, g)
}
