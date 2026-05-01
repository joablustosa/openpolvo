package engine

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/playwright-community/playwright-go"

	"github.com/open-polvo/open-polvo/internal/workflows/domain"
)

// Marcadores no assunto/corpo do nó send_email (substituídos no servidor antes do envio):
//   - {{previous}} — texto agregado dos nós a montante (ligados por aresta a este nó), por ordem de execução; típico após um nó "llm".
//   - {{output:NODE_ID}} — saída textual guardada do nó com esse id (ex.: saída completa de um "llm" ou "web_search").
var (
	reWfPrev   = regexp.MustCompile(`(?i)\{\{\s*previous\s*\}\}`)
	reWfOutput = regexp.MustCompile(`(?i)\{\{\s*output:([^}]+?)\s*\}\}`)
)

// LLMInvoker é chamado para nós tipo "llm".
type LLMInvoker func(ctx context.Context, prompt string) (string, error)

// RunnerConfig controla Playwright e segurança.
type RunnerConfig struct {
	Headless         bool
	ExtraHosts       []string
	AutomationOff    bool
	DefaultTimeoutMs int
	// SerpApi (duckduckgo | google) para nós "web_search".
	SerpAPIKey   string
	SerpDdgKl    string // default se node.data.kl vazio
	SerpDdgSafe  int    // default se node.data.safe == 0
}

func buildPredecessors(g domain.GraphJSON) map[string][]string {
	preds := make(map[string][]string)
	for _, e := range g.Edges {
		if e.Source == "" || e.Target == "" {
			continue
		}
		preds[e.Target] = append(preds[e.Target], e.Source)
	}
	return preds
}

func orderIndex(order []string, id string) int {
	for i, x := range order {
		if x == id {
			return i
		}
	}
	return -1
}

// Texto agregado dos predecessores directos deste nó que já produziram saída (ordem topológica).
func textFromPredecessors(currentID string, order []string, outputs map[string]string, preds map[string][]string) string {
	srcs := preds[currentID]
	if len(srcs) == 0 {
		return ""
	}
	cur := orderIndex(order, currentID)
	type pair struct {
		idx int
		id  string
	}
	var xs []pair
	for _, sid := range srcs {
		idx := orderIndex(order, sid)
		if idx >= 0 && cur >= 0 && idx < cur {
			xs = append(xs, pair{idx, sid})
		}
	}
	sort.Slice(xs, func(i, j int) bool { return xs[i].idx < xs[j].idx })
	var parts []string
	for _, x := range xs {
		if t := strings.TrimSpace(outputs[x.id]); t != "" {
			parts = append(parts, t)
		}
	}
	return strings.Join(parts, "\n\n")
}

func expandEmailTemplates(s, currentID string, order []string, outputs map[string]string, preds map[string][]string) string {
	if s == "" {
		return s
	}
	out := reWfPrev.ReplaceAllStringFunc(s, func(_ string) string {
		return textFromPredecessors(currentID, order, outputs, preds)
	})
	for {
		loc := reWfOutput.FindStringSubmatchIndex(out)
		if loc == nil {
			break
		}
		fullStart, fullEnd := loc[0], loc[1]
		idStart, idEnd := loc[2], loc[3]
		refID := strings.TrimSpace(out[idStart:idEnd])
		repl := outputs[refID]
		out = out[:fullStart] + repl + out[fullEnd:]
	}
	return out
}

// RunGraph executa o DAG com um único browser (headless por defeito).
// mail pode ser nil: nós send_email falham com erro claro.
// social pode ser nil: nós post_facebook / post_instagram / post_whatsapp falham com erro claro.
func RunGraph(ctx context.Context, g domain.GraphJSON, cfg RunnerConfig, llm LLMInvoker, mail *MailDeps, social *SocialDeps) ([]domain.StepLogEntry, error) {
	if cfg.AutomationOff {
		return nil, fmt.Errorf("automação desactivada (AUTOMATION_ENABLED=false)")
	}
	if cfg.DefaultTimeoutMs <= 0 {
		cfg.DefaultTimeoutMs = 30000
	}

	order, err := OrderNodes(g)
	if err != nil {
		return nil, err
	}
	nodeByID := make(map[string]domain.GraphNode)
	for _, n := range g.Nodes {
		nodeByID[n.ID] = n
	}
	preds := buildPredecessors(g)
	outputs := make(map[string]string) // saídas textuais por nó (llm, web_search) para templates em send_email

	pw, err := playwright.Run()
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "install the driver") {
			return nil, fmt.Errorf("playwright: %w — na raiz do repo executa: go run github.com/playwright-community/playwright-go/cmd/playwright@v0.5700.1 install chromium", err)
		}
		return nil, fmt.Errorf("playwright: %w", err)
	}
	defer func() {
		_ = pw.Stop()
	}()

	browser, err := pw.Chromium.Launch(playwright.BrowserTypeLaunchOptions{
		Headless: playwright.Bool(cfg.Headless),
	})
	if err != nil {
		return nil, fmt.Errorf("launch chromium: %w", err)
	}
	defer func() {
		_ = browser.Close()
	}()

	page, err := browser.NewPage()
	if err != nil {
		return nil, fmt.Errorf("new page: %w", err)
	}
	defer func() {
		_ = page.Close()
	}()

	var logs []domain.StepLogEntry
	for _, id := range order {
		n := nodeByID[id]
		step := domain.StepLogEntry{NodeID: id, Type: n.Type}
		to := float64(cfg.DefaultTimeoutMs)
		if n.Data.TimeoutMs > 0 {
			to = float64(n.Data.TimeoutMs)
		}
		page.SetDefaultTimeout(to)
		page.SetDefaultNavigationTimeout(to)

		switch strings.ToLower(strings.TrimSpace(n.Type)) {
		case "schedule":
			// Metadados de agendamento (cron no servidor); execução real é pelo scheduler.
			step.OK = true
			cron := strings.TrimSpace(n.Data.Cron)
			tz := strings.TrimSpace(n.Data.Timezone)
			if tz == "" {
				tz = "UTC"
			}
			if cron != "" {
				step.Message = "agendamento: " + cron + " (" + tz + ")"
			} else {
				step.Message = "agendamento (defina cron no painel)"
			}
			logs = append(logs, step)

		case "goto":
			u := strings.TrimSpace(n.Data.URL)
			if u == "" {
				step.Message = "url vazia"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: url obrigatória", id)
			}
			if !HostAllowed(u, cfg.ExtraHosts) {
				step.Message = "url não permitida pela política"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: host não permitido", id)
			}
			if _, err := page.Goto(u); err != nil {
				step.Message = err.Error()
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("goto %s: %w", id, err)
			}
			step.OK = true
			step.Message = "ok"

		case "click":
			sel := strings.TrimSpace(n.Data.Selector)
			if sel == "" {
				step.Message = "selector vazio"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: selector obrigatório", id)
			}
			if err := page.Click(sel); err != nil {
				step.Message = err.Error()
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("click %s: %w", id, err)
			}
			step.OK = true
			step.Message = "ok"

		case "fill":
			sel := strings.TrimSpace(n.Data.Selector)
			if sel == "" {
				step.Message = "selector vazio"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: selector obrigatório", id)
			}
			val := n.Data.Value
			if err := page.Fill(sel, val); err != nil {
				step.Message = err.Error()
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("fill %s: %w", id, err)
			}
			step.OK = true
			step.Message = "ok"

		case "wait":
			sel := strings.TrimSpace(n.Data.Selector)
			if sel == "" {
				step.Message = "selector vazio"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: selector obrigatório", id)
			}
			if _, err := page.WaitForSelector(sel); err != nil {
				step.Message = err.Error()
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("wait %s: %w", id, err)
			}
			step.OK = true
			step.Message = "ok"

		case "llm":
			if llm == nil {
				step.Message = "LLM não configurado"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: llm indisponível", id)
			}
			prompt := strings.TrimSpace(n.Data.Prompt)
			if prompt == "" {
				step.Message = "prompt vazio"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: prompt obrigatório", id)
			}
			out, err := llm(ctx, prompt)
			if err != nil {
				step.Message = err.Error()
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("llm %s: %w", id, err)
			}
			step.OK = true
			outputs[id] = out
			if len(out) > 200 {
				step.Message = out[:200] + "…"
			} else {
				step.Message = out
			}

		case "web_search":
			query := strings.TrimSpace(n.Data.Query)
			if query == "" {
				step.Message = "query vazia"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: query obrigatória", id)
			}
			if strings.TrimSpace(cfg.SerpAPIKey) == "" {
				step.Message = "SERPAPI_API_KEY não configurada no servidor"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: serpapi não configurado", id)
			}
			kl := strings.TrimSpace(n.Data.Kl)
			if kl == "" {
				kl = strings.TrimSpace(cfg.SerpDdgKl)
			}
			safe := n.Data.Safe
			if safe == 0 {
				safe = cfg.SerpDdgSafe
			}
			params := DuckDuckGoSearchParams{
				APIKey: cfg.SerpAPIKey,
				Query:  query,
				Kl:     kl,
				Df:     strings.TrimSpace(n.Data.Df),
				Safe:   safe,
				Start:  n.Data.Start,
				M:      n.Data.M,
			}
			eng := strings.ToLower(strings.TrimSpace(n.Data.SearchEngine))
			if eng == "" {
				eng = "duckduckgo"
			}
			var out string
			var err error
			switch eng {
			case "duckduckgo":
				out, err = DuckDuckGoSerpSearch(ctx, params)
			case "google":
				out, err = GoogleSerpSearch(ctx, params)
			default:
				step.Message = "search_engine inválido (use duckduckgo ou google)"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: search_engine inválido: %s", id, eng)
			}
			if err != nil {
				step.Message = err.Error()
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("web_search %s: %w", id, err)
			}
			step.OK = true
			outputs[id] = out
			step.Message = out

		case "send_email":
			if mail == nil || mail.Send == nil {
				step.Message = "envio de email não configurado no servidor"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: send_email indisponível", id)
			}

			// Resolver destinatário: email_to (directo) tem prioridade sobre contact_id.
			var toAddr string
			emailToRaw := strings.TrimSpace(n.Data.EmailTo)
			if emailToRaw != "" {
				toAddr = emailToRaw
			} else {
				// Fallback: lookup pelo contact_id na agenda.
				if mail.LookupEmail == nil {
					step.Message = "lookup de contacto não configurado"
					step.OK = false
					logs = append(logs, step)
					return logs, fmt.Errorf("nó %s: lookup indisponível", id)
				}
				cidStr := strings.TrimSpace(n.Data.ContactID)
				if cidStr == "" {
					step.Message = "destinatário obrigatório: preencha o campo E-mail ou escolha um contacto"
					step.OK = false
					logs = append(logs, step)
					return logs, fmt.Errorf("nó %s: destinatário obrigatório", id)
				}
				cid, err := uuid.Parse(cidStr)
				if err != nil {
					step.Message = "contact_id inválido"
					step.OK = false
					logs = append(logs, step)
					return logs, fmt.Errorf("nó %s: contact_id inválido", id)
				}
				addr, err := mail.LookupEmail(ctx, cid)
				if err != nil {
					step.Message = err.Error()
					step.OK = false
					logs = append(logs, step)
					return logs, fmt.Errorf("send_email %s: %w", id, err)
				}
				toAddr = strings.TrimSpace(addr)
				if toAddr == "" {
					step.Message = "contacto sem email"
					step.OK = false
					logs = append(logs, step)
					return logs, fmt.Errorf("nó %s: contacto sem email", id)
				}
			}

			sub := strings.TrimSpace(expandEmailTemplates(n.Data.EmailSubject, id, order, outputs, preds))
			if sub == "" {
				step.Message = "email_subject obrigatório (após substituir {{previous}} / {{output:…}})"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: email_subject obrigatório", id)
			}
			body := strings.TrimSpace(expandEmailTemplates(n.Data.EmailBody, id, order, outputs, preds))
			if body == "" {
				step.Message = "email_body obrigatório (após substituir {{previous}} / {{output:…}})"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: email_body obrigatório", id)
			}
			if err := mail.Send(ctx, toAddr, sub, body); err != nil {
				step.Message = err.Error()
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("send_email %s: %w", id, err)
			}
			step.OK = true
			step.Message = "email enviado para " + toAddr

		case "post_facebook", "post_instagram":
			if social == nil || social.PostMeta == nil {
				step.Message = "publicação social não configurada no servidor"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: social indisponível", id)
			}
			plat := "facebook"
			if strings.EqualFold(strings.TrimSpace(n.Type), "post_instagram") {
				plat = "instagram"
			}
			msg := strings.TrimSpace(expandEmailTemplates(n.Data.Caption, id, order, outputs, preds))
			if msg == "" {
				step.Message = "caption obrigatório (use {{previous}} após um nó LLM)"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: caption obrigatório", id)
			}
			img := strings.TrimSpace(expandEmailTemplates(n.Data.ImageURL, id, order, outputs, preds))
			pid, err := social.PostMeta(ctx, plat, msg, img)
			if err != nil {
				step.Message = err.Error()
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("post_%s %s: %w", plat, id, err)
			}
			step.OK = true
			outputs[id] = msg
			step.Message = "publicado (" + plat + ") id=" + pid

		case "post_whatsapp":
			if social == nil || social.SendWA == nil {
				step.Message = "WhatsApp não configurado no servidor"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: whatsapp indisponível", id)
			}
			to := strings.TrimSpace(n.Data.WhatsAppTo)
			if to == "" {
				step.Message = "whatsapp_to obrigatório (número destino)"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: whatsapp_to obrigatório", id)
			}
			txt := strings.TrimSpace(expandEmailTemplates(n.Data.Caption, id, order, outputs, preds))
			if txt == "" {
				step.Message = "caption/texto obrigatório"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: texto obrigatório", id)
			}
			mid, err := social.SendWA(ctx, to, txt)
			if err != nil {
				step.Message = err.Error()
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("post_whatsapp %s: %w", id, err)
			}
			step.OK = true
			outputs[id] = txt
			step.Message = "WhatsApp enviado id=" + mid

		case "post_linkedin", "post_x", "post_twitter", "post_youtube":
			if llm == nil {
				step.Message = "LLM não configurado"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: llm indisponível", id)
			}
			plat := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(n.Type)), "post_")
			if plat == "twitter" {
				plat = "x"
			}
			sys := systemPromptSocialDraft(plat, n.Data.YoutubeFormat)
			userBits := []string{
				"Pedido de conteúdo para a plataforma: " + plat,
			}
			if strings.TrimSpace(n.Data.LinkURL) != "" {
				userBits = append(userBits, "Link de referência: "+strings.TrimSpace(n.Data.LinkURL))
			}
			if strings.TrimSpace(n.Data.VideoURL) != "" {
				userBits = append(userBits, "Vídeo de referência (URL): "+strings.TrimSpace(n.Data.VideoURL))
			}
			if n.Data.PostsPerDay > 0 {
				userBits = append(userBits, fmt.Sprintf("Meta: o utilizador pretende cerca de %d publicações por dia (ajusta tom de urgência levemente).", n.Data.PostsPerDay))
			}
			brief := strings.TrimSpace(expandEmailTemplates(n.Data.Caption, id, order, outputs, preds))
			if brief == "" {
				brief = strings.TrimSpace(expandEmailTemplates(n.Data.Prompt, id, order, outputs, preds))
			}
			if brief == "" {
				step.Message = "caption ou prompt obrigatório"
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("nó %s: caption/prompt obrigatório", id)
			}
			userBits = append(userBits, "Brief / notas:\n"+brief)
			fullUser := strings.Join(userBits, "\n\n")
			out, err := llm(ctx, sys+"\n\n"+fullUser)
			if err != nil {
				step.Message = err.Error()
				step.OK = false
				logs = append(logs, step)
				return logs, fmt.Errorf("post_%s %s: %w", plat, id, err)
			}
			step.OK = true
			outputs[id] = out
			step.Message = "rascunho " + plat + " (sem API de publicação no servidor — copiar para a rede)"
			if len(out) > 220 {
				step.Message = step.Message + ": " + out[:220] + "…"
			} else {
				step.Message = step.Message + ": " + out
			}

		default:
			step.Message = "tipo desconhecido: " + n.Type
			step.OK = false
			logs = append(logs, step)
			return logs, fmt.Errorf("tipo de nó não suportado: %s", n.Type)
		}
		logs = append(logs, step)

		select {
		case <-ctx.Done():
			return logs, ctx.Err()
		default:
		}
		time.Sleep(50 * time.Millisecond)
	}
	return logs, nil
}
