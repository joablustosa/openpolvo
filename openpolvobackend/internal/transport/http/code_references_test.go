package httptransport

import (
	"strings"
	"testing"
)

func TestApplyCodeReferences(t *testing.T) {
	text, meta := applyCodeReferences("Explique isto", []codeReferenceDTO{
		{Path: "src/foo.ts", StartLine: 1, EndLine: 3, Text: "const x = 1;"},
	})
	if meta == nil {
		t.Fatal("expected metadata")
	}
	refs, ok := meta["code_references"].([]map[string]any)
	if !ok || len(refs) != 1 {
		t.Fatalf("expected one stored reference, got %#v", meta)
	}
	if refs[0]["path"] != "src/foo.ts" {
		t.Fatalf("unexpected path: %#v", refs[0]["path"])
	}
	if !strings.Contains(text, "Seleção (src/foo.ts:L1-3):") {
		t.Fatalf("text not enriched: %q", text)
	}
	if !strings.Contains(text, "const x = 1;") {
		t.Fatalf("code block missing: %q", text)
	}
}

func TestApplyCodeReferencesEmpty(t *testing.T) {
	text, meta := applyCodeReferences("hello", nil)
	if meta != nil {
		t.Fatalf("expected nil metadata, got %#v", meta)
	}
	if text != "hello" {
		t.Fatalf("text changed: %q", text)
	}
}
