package polvointel

import (
	"encoding/json"
	"strings"

	agentports "github.com/open-polvo/open-polvo/internal/agent/ports"
)

type replyHTTPBody struct {
	Messages              []msgPart                       `json:"messages"`
	ModelProvider         string                          `json:"model_provider"`
	OpenAIAPIKey          string                          `json:"openai_api_key,omitempty"`
	GoogleAPIKey          string                          `json:"google_api_key,omitempty"`
	OpenAIModel           string                          `json:"openai_model,omitempty"`
	GoogleModel           string                          `json:"google_model,omitempty"`
	ConversationID        string                          `json:"conversation_id,omitempty"`
	AgentMemory           map[string]string               `json:"agent_memory,omitempty"`
	SMTPContext           *agentports.SMTPContext         `json:"smtp_context,omitempty"`
	ContactsContext       []agentports.ContactBrief       `json:"contacts_context,omitempty"`
	TaskListsContext      []agentports.TaskListBrief      `json:"task_lists_context,omitempty"`
	FinanceContext        *agentports.FinanceContext      `json:"finance_context,omitempty"`
	MetaContext           *agentports.MetaContext         `json:"meta_context,omitempty"`
	ScheduledTasksContext []agentports.ScheduledTaskBrief `json:"scheduled_tasks_context,omitempty"`
	SandboxProjectID      string                          `json:"sandbox_project_id,omitempty"`
	ProjectFileTree       []string                        `json:"project_file_tree,omitempty"`
	ProjectFiles          map[string]string               `json:"project_files,omitempty"`
	PreviewConsoleLogs    []map[string]any                `json:"preview_console_logs,omitempty"`
	DevStudioContext      map[string]any                  `json:"dev_studio_context,omitempty"`
	CompileLog            string                          `json:"compile_log,omitempty"`
	DeskContext           map[string]any                  `json:"desk_context,omitempty"`
}

type msgPart struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// DevStudioFields transporta payload Dev Studio do HTTP handler até ao Intelligence.
type DevStudioFields struct {
	SandboxProjectID   string
	ProjectFileTree    []string
	ProjectFiles       map[string]string
	PreviewConsoleLogs []map[string]any
	DevStudioContext   map[string]any
	CompileLog         string
}

func ApplyDevStudioFields(in *agentports.ReplyInput, ds DevStudioFields) {
	in.SandboxProjectID = ds.SandboxProjectID
	in.ProjectFileTree = ds.ProjectFileTree
	in.ProjectFiles = ds.ProjectFiles
	in.PreviewConsoleLogs = ds.PreviewConsoleLogs
	in.DevStudioContext = ds.DevStudioContext
	in.CompileLog = ds.CompileLog
}

func marshalReplyBody(in agentports.ReplyInput) ([]byte, error) {
	deskMode := len(in.DeskContext) > 0
	body := replyHTTPBody{
		ModelProvider:  string(in.ModelProvider),
		OpenAIAPIKey:   in.OpenAIAPIKey,
		GoogleAPIKey:   in.GoogleAPIKey,
		OpenAIModel:    in.OpenAIModel,
		GoogleModel:    in.GoogleModel,
		ConversationID: strings.TrimSpace(in.ConversationID),
		DeskContext:    in.DeskContext,
	}
	body.SMTPContext = in.SMTP
	if !deskMode {
		body.ContactsContext = in.Contacts
		body.TaskListsContext = in.TaskLists
		body.FinanceContext = in.Finance
		body.MetaContext = in.Meta
		body.ScheduledTasksContext = in.ScheduledTasks
		body.SandboxProjectID = in.SandboxProjectID
		body.ProjectFileTree = in.ProjectFileTree
		body.ProjectFiles = in.ProjectFiles
		body.PreviewConsoleLogs = in.PreviewConsoleLogs
		body.DevStudioContext = in.DevStudioContext
		body.CompileLog = in.CompileLog
	}
	if in.AgentMemory != nil {
		body.AgentMemory = map[string]string{
			"global":  in.AgentMemory.Global,
			"builder": in.AgentMemory.Builder,
		}
	}
	for _, m := range in.Messages {
		body.Messages = append(body.Messages, msgPart{Role: m.Role, Content: m.Content})
	}
	return json.Marshal(body)
}
