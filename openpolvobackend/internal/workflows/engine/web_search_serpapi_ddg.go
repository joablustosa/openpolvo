package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
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

func serpOrganicSearch(ctx context.Context, engine string, resultsTitle string, p DuckDuckGoSearchParams) (string, error) {
	q := strings.TrimSpace(p.Query)
	if q == "" {
		return "", fmt.Errorf("query vazia")
	}
	if len(q) > 500 {
		q = q[:500]
	}
	if strings.TrimSpace(p.APIKey) == "" {
		return "", fmt.Errorf("SERPAPI_API_KEY vazia")
	}
	engine = strings.ToLower(strings.TrimSpace(engine))
	if engine != "duckduckgo" && engine != "google" {
		return "", fmt.Errorf("motor serpapi não suportado: %s", engine)
	}

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
		if p.M > 0 {
			qs.Set("m", fmt.Sprint(p.M))
		}
	case "google":
		if p.Safe != 0 {
			qs.Set("safe", fmt.Sprint(p.Safe))
		}
		if p.Start > 0 {
			qs.Set("start", fmt.Sprint(p.Start))
		}
		if p.M > 0 {
			qs.Set("num", fmt.Sprint(p.M))
		}
	}
	u.RawQuery = qs.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 25 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("serpapi status %d", resp.StatusCode)
	}
	var out ddgSerpApiResp
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("decode serpapi: %w", err)
	}
	if strings.EqualFold(strings.TrimSpace(out.SearchMetadata.Status), "Error") && strings.TrimSpace(out.SearchMetadata.Error) != "" {
		return "", fmt.Errorf("serpapi error: %s", out.SearchMetadata.Error)
	}

	var b strings.Builder
	b.WriteString(resultsTitle)
	b.WriteString(":\n")
	max := 3
	if len(out.OrganicResults) < max {
		max = len(out.OrganicResults)
	}
	for i := 0; i < max; i++ {
		r := out.OrganicResults[i]
		title := strings.TrimSpace(r.Title)
		link := strings.TrimSpace(r.Link)
		if title == "" && link == "" {
			continue
		}
		b.WriteString(fmt.Sprintf("%d) %s\n%s\n", i+1, title, link))
	}
	if max == 0 {
		b.WriteString("(sem resultados orgânicos)\n")
	}
	return strings.TrimSpace(b.String()), nil
}

// DuckDuckGoSerpSearch chama https://serpapi.com/search?engine=duckduckgo&q=... e devolve um resumo curto.
func DuckDuckGoSerpSearch(ctx context.Context, p DuckDuckGoSearchParams) (string, error) {
	return serpOrganicSearch(ctx, "duckduckgo", "Resultados DuckDuckGo", p)
}

// GoogleSerpSearch chama https://serpapi.com/search?engine=google&q=... com a mesma SERPAPI_API_KEY.
func GoogleSerpSearch(ctx context.Context, p DuckDuckGoSearchParams) (string, error) {
	return serpOrganicSearch(ctx, "google", "Resultados Google", p)
}
