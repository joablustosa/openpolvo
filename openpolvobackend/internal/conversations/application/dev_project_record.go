package application

import (
	"context"
	"log/slog"

	"github.com/google/uuid"

	convports "github.com/open-polvo/open-polvo/internal/conversations/ports"
)

// recordDevProject persiste (best-effort) uma versão do projeto de dev ligado à
// conversa quando o metadata indica trabalho de dev. Falhas são registadas mas
// não abortam o fluxo de resposta ao utilizador.
func recordDevProject(ctx context.Context, rec convports.DevProjectRecorder, userID, conversationID uuid.UUID, assistantText string, meta map[string]any) {
	if rec == nil || meta == nil {
		return
	}
	if err := rec.RecordFromAssistantMessage(ctx, userID, conversationID, assistantText, meta); err != nil {
		slog.Error("persist dev project version", "conversation_id", conversationID.String(), "err", err)
	}
}
