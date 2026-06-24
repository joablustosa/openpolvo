package polvointel

import agentports "github.com/open-polvo/open-polvo/internal/agent/ports"

// StripLegacyContextsForDesk remove payloads Zé Polvinho quando o fluxo Desk está activo.
func StripLegacyContextsForDesk(in *agentports.ReplyInput) {
	if in == nil || len(in.DeskContext) == 0 {
		return
	}
	in.SMTP = nil
	in.Contacts = nil
	in.TaskLists = nil
	in.Finance = nil
	in.Meta = nil
	in.ScheduledTasks = nil
	in.SandboxProjectID = ""
	in.ProjectFileTree = nil
	in.ProjectFiles = nil
	in.PreviewConsoleLogs = nil
	in.DevStudioContext = nil
	in.CompileLog = ""
}
