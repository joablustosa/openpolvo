package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	wfports "github.com/open-polvo/open-polvo/internal/workflows/ports"
)

type DuckDuckGoSearchParams struct {
	APIKey string
	Query  string
	Kl     string
	Df     string
	Safe   int
	Start  int
	M      int
}

type ddgSerpApiResp struct {
	SearchMetadata struct {
		Status string `json:"status"`
		ID     string `json:"id"`
		Error  string `json:"error"`
	} `json:"search_metadata"`
	OrganicResults []struct {
		Position int    `json:"position"`
		Title    string `json:"title"`
		Link     string `json:"link"`
		Snippet  string `json:"snippet"`
	} `json:"organic_results"`
	RelatedSearches []struct {
		Query string `json:"query"`
	} `json:"related_searches"`
}

// serpNumResults devolve 1..10 para pedir à SerpAPI (campo M do nó ou omissão 8).
func serpNumResults(m int) int {
	if m >= 1 && m <= 10 {
		return m
	}
	return 8
}

// FetchSerpOrganicHits chama SerpAPI e devolve resultados orgânicos com snippet.
func FetchSerpOrganicHits(ctx context.Context, engine string, p DuckDuckGoSearchParams) ([]wfports.WebSearchOrganicHit, error) {
	q := strings.TrimSpace(p.Query)
	if q == "" {
		return nil, fmt.Errorf("query vazia")
	}
	if len(q) > 500 {
		q = q[:500]
	}
	if strings.TrimSpace(p.APIKey) == "" {
		return nil, fmt.Errorf("SERPAPI_API_KEY vazia")
	}
	engine = strings.ToLower(strings.TrimSpace(engine))
	if engine != "duckduckgo" && engine != "google" {
		return nil, fmt.Errorf("motor serpapi não suportado: %s", engine)
	}

	num := serpNumResults(p.M)

	u, _ := url.Parse("https://serpapi.com/search")
	qs := u.Query()
	qs.Set("engine", engine)
	qs.Set("q", q)
	qs.Set("api_key", strings.TrimSpace(p.APIKey))
	qs.Set("output", "json")

	switch engine {
	case "duckduckgo":
		if strings.TrimSpace(p.Kl) != "" {
			qs.Set("kl", strings.TrimSpace(p.Kl))
		}
		if strings.TrimSpace(p.Df) != "" {
			qs.Set("df", strings.TrimSpace(p.Df))
		}
		if p.Safe != 0 {
			qs.Set("safe", fmt.Sprint(p.Safe))
		}
		if p.Start > 0 {
			qs.Set("start", fmt.Sprint(p.Start))
		}
		qs.Set("m", fmt.Sprint(num))
	case "google":
		if p.Safe != 0 {
			qs.Set("safe", fmt.Sprint(p.Safe))
		}
		if p.Start > 0 {
			qs.Set("start", fmt.Sprint(p.Start))
		}
		qs.Set("num", fmt.Sprint(num))
	}
	u.RawQuery = qs.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 25 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("serpapi status %d", resp.StatusCode)
	}
	var out ddgSerpApiResp
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode serpapi: %w", err)
	}
	if strings.EqualFold(strings.TrimSpace(out.SearchMetadata.Status), "Error") && strings.TrimSpace(out.SearchMetadata.Error) != "" {
		return nil, fmt.Errorf("serpapi error: %s", out.SearchMetadata.Error)
	}

	var hits []wfports.WebSearchOrganicHit
	for _, r := range out.OrganicResults {
		title := strings.TrimSpace(r.Title)
		link := strings.TrimSpace(r.Link)
		if title == "" && link == "" {
			continue
		}
		hits = append(hits, wfports.WebSearchOrganicHit{
			Title:   title,
			Link:    link,
			Snippet: strings.TrimSpace(r.Snippet),
		})
	}
	return hits, nil
}

// FormatSerpMarkdown formata até `limit` resultados com título, URL e snippet.
func FormatSerpMarkdown(hits []wfports.WebSearchOrganicHit, resultsTitle string, limit int) string {
	if limit <= 0 {
		limit = 8
	}
	if limit > len(hits) {
		limit = len(hits)
	}
	var b strings.Builder
	b.WriteString(resultsTitle)
	b.WriteString(":\n\n")
	if limit == 0 {
		b.WriteString("(sem resultados orgânicos)\n")
		return strings.TrimSpace(b.String())
	}
	for i := 0; i < limit; i++ {
		r := hits[i]
		b.WriteString(fmt.Sprintf("### %d) %s\n", i+1, r.Title))
		if r.Link != "" {
			b.WriteString(r.Link + "\n")
		}
		if r.Snippet != "" {
			b.WriteString(r.Snippet + "\n")
		}
		b.WriteString("\n")
	}
	return strings.TrimSpace(b.String())
}

// DuckDuckGoSerpSearch chama SerpAPI (duckduckgo) e devolve Markdown com snippets.
func DuckDuckGoSerpSearch(ctx context.Context, p DuckDuckGoSearchParams) (string, error) {
	hits, err := FetchSerpOrganicHits(ctx, "duckduckgo", p)
	if err != nil {
		return "", err
	}
	lim := serpNumResults(p.M)
	return FormatSerpMarkdown(hits, "Resultados DuckDuckGo", lim), nil
}

// GoogleSerpSearch chama SerpAPI (google) e devolve Markdown com snippets.
func GoogleSerpSearch(ctx context.Context, p DuckDuckGoSearchParams) (string, error) {
	hits, err := FetchSerpOrganicHits(ctx, "google", p)
	if err != nil {
		return "", err
	}
	lim := serpNumResults(p.M)
	return FormatSerpMarkdown(hits, "Resultados Google", lim), nil
}
