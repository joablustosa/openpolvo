package engine

import "strings"

func systemPromptSocialDraft(platform string, youtubeFormat string) string {
	p := strings.ToLower(strings.TrimSpace(platform))
	yf := strings.ToLower(strings.TrimSpace(youtubeFormat))
	switch p {
	case "linkedin":
		return "És um especialista em copy para LinkedIn (profissional, tom de thought leadership, " +
			"hashtags moderadas). Devolve só o texto do post final, sem markdown fences."
	case "x", "twitter":
		return "És um especialista em posts para X (Twitter): concisão, thread opcional se necessário, " +
			"tom adequado a marca pessoal. Respeita ~280 caracteres por tweet; se precisares de thread, " +
			"numera 1/n. Sem markdown fences."
	case "youtube":
		if yf == "short" {
			return "És um especialista em YouTube Shorts: gancho nos 2 primeiros segundos, CTA curto, " +
				"título chamativo e descrição com hashtags. Devolve: TÍTULO numa linha, depois DESCRIÇÃO " +
				"(bloco único). Sem markdown fences."
		}
		return "És um especialista em vídeos longos no YouTube: título SEO, descrição com capítulos " +
			"(timestamps fictícios se não houver dados), tags e primeira linha de gancho. " +
			"Devolve: TÍTULO, depois DESCRIÇÃO. Sem markdown fences."
	default:
		return "És um redactor de redes sociais. Devolve só o texto final do post. Sem markdown fences."
	}
}
