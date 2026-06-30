package httptransport

import (
	"fmt"
	"strings"
)

type codeReferenceDTO struct {
	Path      string `json:"path"`
	StartLine int    `json:"start_line"`
	EndLine   int    `json:"end_line"`
	Text      string `json:"text"`
}

const codeReferencePreviewChars = 200

func applyCodeReferences(text string, refs []codeReferenceDTO) (string, map[string]any) {
	if len(refs) == 0 {
		return text, nil
	}
	var blocks []string
	stored := make([]map[string]any, 0, len(refs))
	for _, ref := range refs {
		path := strings.TrimSpace(ref.Path)
		body := strings.TrimSpace(ref.Text)
		if path == "" || body == "" {
			continue
		}
		header := fmt.Sprintf("Seleção (%s:L%d-%d):", path, ref.StartLine, ref.EndLine)
		blocks = append(blocks, fmt.Sprintf("%s\n```\n%s\n```", header, body))
		preview := body
		if len([]rune(preview)) > codeReferencePreviewChars {
			preview = string([]rune(preview)[:codeReferencePreviewChars]) + "…"
		}
		stored = append(stored, map[string]any{
			"path":       path,
			"start_line": ref.StartLine,
			"end_line":   ref.EndLine,
			"text":       body,
			"preview":    preview,
		})
	}
	if len(blocks) == 0 {
		return text, nil
	}
	enriched := strings.TrimSpace(text)
	if enriched != "" {
		enriched = enriched + "\n\n---\n" + strings.Join(blocks, "\n\n")
	} else {
		enriched = strings.Join(blocks, "\n\n")
	}
	return enriched, map[string]any{"code_references": stored}
}
