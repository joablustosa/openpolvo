package application

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/projects/ports"
)

// Recorder persiste uma versão de projeto a partir da mensagem do assistant,
// quando o metadata indica trabalho de dev (polvo_code_ops ou dev_studio_context.project_files).
// Implementa estruturalmente o contrato consumido pelo módulo conversations.
type Recorder struct {
	Ensure *EnsureProjectForConversation
	Save   *SaveProjectVersion
	Repo   ports.ProjectRepository
}

// RecordFromAssistantMessage é um no-op quando o metadata não tem trabalho de dev.
// Em caso de trabalho de dev, garante o projeto e grava uma nova versão.
func (r *Recorder) RecordFromAssistantMessage(ctx context.Context, userID, conversationID uuid.UUID, assistantText string, metadata map[string]any) error {
	if r == nil || r.Ensure == nil || r.Save == nil || r.Repo == nil {
		return nil
	}
	ops := opsFromMetadata(metadata)
	projectFiles := projectFilesFromMetadata(metadata)
	if len(ops) == 0 && len(projectFiles) == 0 {
		return nil
	}

	project, _, err := r.Ensure.Execute(ctx, EnsureInput{
		UserID:         userID,
		ConversationID: conversationID,
		Title:          titleFromMetadata(metadata),
		Kind:           kindFromMetadata(metadata),
		Stack:          "",
	})
	if err != nil {
		return err
	}

	files, err := r.resolveFiles(ctx, project.ID, projectFiles, ops)
	if err != nil {
		return err
	}
	if len(files) == 0 {
		return nil
	}

	summary := summaryFromText(assistantText)
	if summary == "" {
		summary = kindFromMetadata(metadata)
	}
	if _, _, err := r.Save.Execute(ctx, SaveVersionInput{
		Project: project,
		Summary: summary,
		Files:   files,
	}); err != nil {
		return err
	}
	return nil
}

// resolveFiles prefere project_files explícitos; caso só haja ops, aplica as ops "write"
// sobre os ficheiros da versão anterior.
func (r *Recorder) resolveFiles(ctx context.Context, projectID uuid.UUID, projectFiles map[string]string, ops []codeOp) (map[string]string, error) {
	if len(projectFiles) > 0 {
		return projectFiles, nil
	}
	if len(ops) == 0 {
		return nil, nil
	}
	merged := map[string]string{}
	latest, err := r.Repo.GetLatestVersion(ctx, projectID)
	switch {
	case err == nil:
		prev, ferr := r.Repo.GetFilesByVersion(ctx, latest.ID)
		if ferr != nil {
			return nil, ferr
		}
		for _, f := range prev {
			merged[f.Path] = f.Content
		}
	case errors.Is(err, ErrNotFound):
		// Projeto sem versões anteriores: aplica as ops a partir de vazio.
	default:
		return nil, err
	}
	for _, op := range ops {
		if op.Op != "write" || op.Path == "" {
			continue
		}
		merged[op.Path] = op.Content
	}
	return merged, nil
}

// ─── parsing de metadata (map[string]any do reply do Intelligence) ───────────

type codeOp struct {
	Op      string
	Path    string
	Content string
}

func opsFromMetadata(meta map[string]any) []codeOp {
	raw, ok := meta["polvo_code_ops"].([]any)
	if !ok {
		return nil
	}
	out := make([]codeOp, 0, len(raw))
	for _, item := range raw {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		out = append(out, codeOp{
			Op:      strings.ToLower(strings.TrimSpace(stringFrom(m, "op"))),
			Path:    strings.TrimSpace(stringFrom(m, "path")),
			Content: stringFrom(m, "content"),
		})
	}
	return out
}

func projectFilesFromMetadata(meta map[string]any) map[string]string {
	ctxMap, ok := meta["dev_studio_context"].(map[string]any)
	if !ok {
		return nil
	}
	filesRaw, ok := ctxMap["project_files"].(map[string]any)
	if !ok {
		return nil
	}
	out := make(map[string]string, len(filesRaw))
	for path, v := range filesRaw {
		p := strings.TrimSpace(path)
		if p == "" {
			continue
		}
		if s, ok := v.(string); ok {
			out[p] = s
		}
	}
	return out
}

func kindFromMetadata(meta map[string]any) string {
	if dw, ok := meta["dev_workflow"].(map[string]any); ok {
		if k := strings.TrimSpace(stringFrom(dw, "request_kind")); k != "" {
			return k
		}
	}
	if k := strings.TrimSpace(stringFrom(meta, "intent")); k != "" {
		return k
	}
	return ""
}

func titleFromMetadata(meta map[string]any) string {
	return strings.TrimSpace(stringFrom(meta, "polvo_code_project_title"))
}

func summaryFromText(text string) string {
	for _, line := range strings.Split(text, "\n") {
		if s := strings.TrimSpace(line); s != "" {
			return s
		}
	}
	return ""
}

func stringFrom(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	if s, ok := m[key].(string); ok {
		return s
	}
	return ""
}
