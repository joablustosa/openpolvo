package httptransport

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/open-polvo/open-polvo/internal/agent/adapters/polvointel"
)

// PolvoCodeHandlers expõe utilitários para o cliente desktop (validação antes de IPC).
type PolvoCodeHandlers struct {
	Intel *polvointel.Client
}

type polvoCodeOpIn struct {
	Op      string `json:"op"`
	Path    string `json:"path"`
	Content string `json:"content"`
}

type polvoValidateReq struct {
	Ops        []polvoCodeOpIn `json:"ops"`
	NpmInstall bool            `json:"npm_install"`
}

type polvoValidateResp struct {
	OK       bool             `json:"ok"`
	ValidOps []map[string]any `json:"valid_ops"`
	Errors   []string         `json:"errors,omitempty"`
}

const polvoMaxOps = 100
const polvoMaxPath = 512
const polvoMaxContent = 512 * 1024

// PostValidateOps valida caminhos relativos e tamanhos (espelha regras do processo Electron).
func (PolvoCodeHandlers) PostValidateOps(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req polvoValidateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	var errs []string
	ops := req.Ops
	if len(ops) > polvoMaxOps {
		errs = append(errs, "demasiadas operações")
		ops = ops[:polvoMaxOps]
	}
	out := make([]map[string]any, 0, len(ops))
	for i, o := range ops {
		op := strings.ToLower(strings.TrimSpace(o.Op))
		if op != "write" && op != "mkdir" {
			errs = append(errs, "op desconhecida no índice "+strconv.Itoa(i))
			continue
		}
		p := strings.TrimSpace(strings.ReplaceAll(o.Path, "\\", "/"))
		p = strings.TrimPrefix(p, "/")
		if p == "" || strings.Contains(p, "..") {
			errs = append(errs, "path inválido no índice "+strconv.Itoa(i))
			continue
		}
		if len(p) > polvoMaxPath {
			errs = append(errs, "path demasiado longo no índice "+strconv.Itoa(i))
			continue
		}
		if op == "write" && len(o.Content) > polvoMaxContent {
			errs = append(errs, "conteúdo demasiado grande no índice "+strconv.Itoa(i))
			continue
		}
		m := map[string]any{"op": op, "path": p}
		if op == "write" {
			m["content"] = o.Content
		}
		out = append(out, m)
	}
	writeJSON(w, http.StatusOK, polvoValidateResp{OK: len(errs) == 0, ValidOps: out, Errors: errs})
}

type devStudioSelfHealReq struct {
	ModelProvider      string              `json:"model_provider"`
	UserPrompt         string              `json:"user_prompt,omitempty"`
	CompileLog         string              `json:"compile_log,omitempty"`
	PreviewConsoleLogs []map[string]any    `json:"preview_console_logs,omitempty"`
	ProjectFiles       map[string]string   `json:"project_files,omitempty"`
	DevStudioContext   map[string]any      `json:"dev_studio_context,omitempty"`
}

type devStudioSelfHealResp struct {
	AssistantText string         `json:"assistant_text"`
	Metadata      map[string]any `json:"metadata"`
}

// PostDevStudioSelfHeal encaminha correcção automática de erros de build ao Intelligence.
func (h *PolvoCodeHandlers) PostDevStudioSelfHeal(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.Intel == nil || !h.Intel.Configured() {
		writeError(w, http.StatusServiceUnavailable, "Open Polvo Intelligence não configurado")
		return
	}
	var req devStudioSelfHealReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if strings.TrimSpace(req.CompileLog) == "" && len(req.PreviewConsoleLogs) == 0 {
		writeError(w, http.StatusBadRequest, "compile_log ou preview_console_logs obrigatório")
		return
	}
	text, meta, err := h.Intel.DevStudioSelfHeal(r.Context(), polvointel.DevStudioSelfHealInput{
		ModelProvider:      req.ModelProvider,
		UserPrompt:         req.UserPrompt,
		CompileLog:         req.CompileLog,
		PreviewConsoleLogs: req.PreviewConsoleLogs,
		ProjectFiles:       req.ProjectFiles,
		DevStudioContext:   req.DevStudioContext,
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, devStudioSelfHealResp{AssistantText: text, Metadata: meta})
}
