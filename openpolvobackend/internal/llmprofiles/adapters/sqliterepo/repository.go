package sqliterepo

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/llmprofiles/domain"
	"github.com/open-polvo/open-polvo/internal/llmprofiles/ports"
	mailcrypto "github.com/open-polvo/open-polvo/internal/mail/crypto"
	platformcfg "github.com/open-polvo/open-polvo/internal/platform/config"
)

func parseFlexTime(s string) time.Time {
	s = strings.TrimSpace(s)
	for _, layout := range []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05.999999999-07:00",
		"2006-01-02 15:04:05",
	} {
		if t, e := time.Parse(layout, s); e == nil {
			return t.UTC()
		}
	}
	return time.Now().UTC()
}

type Repository struct {
	DB  *sql.DB
	Cfg platformcfg.Config

	llmSchemaMu sync.Mutex
	llmSchemaOK bool
}

var _ ports.Repository = (*Repository)(nil)

// ensureLLMSchema cria tabelas de perfis/prefs se ainda não existirem (BD antiga ou migração 019 por aplicar).
func (r *Repository) ensureLLMSchema(ctx context.Context) error {
	r.llmSchemaMu.Lock()
	defer r.llmSchemaMu.Unlock()
	if r.llmSchemaOK {
		return nil
	}
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS laele_llm_profiles (
			id TEXT NOT NULL PRIMARY KEY,
			display_name TEXT NOT NULL,
			provider TEXT NOT NULL CHECK (provider IN ('openai','google')),
			model_id TEXT NOT NULL,
			api_key_enc BLOB NOT NULL,
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_laele_llm_profiles_sort ON laele_llm_profiles (sort_order, created_at)`,
		`CREATE TABLE IF NOT EXISTS laele_llm_agent_prefs (
			id TEXT NOT NULL PRIMARY KEY CHECK (id = 'singleton'),
			agent_mode TEXT NOT NULL DEFAULT 'auto' CHECK (agent_mode IN ('auto','profile')),
			default_profile_id TEXT NULL,
			updated_at TEXT NOT NULL,
			FOREIGN KEY (default_profile_id) REFERENCES laele_llm_profiles(id) ON DELETE SET NULL
		)`,
		`INSERT OR IGNORE INTO laele_llm_agent_prefs (id, agent_mode, updated_at) VALUES ('singleton', 'auto', datetime('now'))`,
	}
	for _, q := range stmts {
		if _, err := r.DB.ExecContext(ctx, q); err != nil {
			return err
		}
	}
	r.llmSchemaOK = true
	return nil
}

func (r *Repository) decryptKey(blob []byte) (string, error) {
	if len(blob) == 0 {
		return "", nil
	}
	key := mailcrypto.KeyForLLMProfile(r.Cfg)
	pt, err := mailcrypto.DecryptAES256GCM(blob, key)
	if err != nil {
		return "", err
	}
	return string(pt), nil
}

func (r *Repository) ListProfiles(ctx context.Context) ([]domain.Profile, error) {
	if err := r.ensureLLMSchema(ctx); err != nil {
		return nil, err
	}
	rows, err := r.DB.QueryContext(ctx,
		`SELECT id, display_name, provider, model_id, sort_order, created_at, updated_at,
		        CASE WHEN length(api_key_enc) > 0 THEN 1 ELSE 0 END
		 FROM laele_llm_profiles ORDER BY sort_order ASC, created_at ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Profile
	for rows.Next() {
		var (
			id, name, prov, model string
			sort                  int
			created, updated      string
			hasCipher             int
		)
		if err := rows.Scan(&id, &name, &prov, &model, &sort, &created, &updated, &hasCipher); err != nil {
			return nil, err
		}
		pid, err := uuid.Parse(id)
		if err != nil {
			continue
		}
		ct := parseFlexTime(created)
		ut := parseFlexTime(updated)
		out = append(out, domain.Profile{
			ID:           pid,
			DisplayName:  name,
			Provider:     prov,
			ModelID:      model,
			SortOrder:    sort,
			CreatedAt:    ct,
			UpdatedAt:    ut,
			HasKeyCipher: hasCipher != 0,
		})
	}
	return out, rows.Err()
}

func (r *Repository) GetProfileByID(ctx context.Context, id uuid.UUID) (*domain.Profile, error) {
	if err := r.ensureLLMSchema(ctx); err != nil {
		return nil, err
	}
	row := r.DB.QueryRowContext(ctx,
		`SELECT id, display_name, provider, model_id, api_key_enc, sort_order, created_at, updated_at
		 FROM laele_llm_profiles WHERE id = ?`,
		id.String(),
	)
	var (
		idStr, name, prov, model string
		keyEnc                    []byte
		sort                      int
		created, updated          string
	)
	if err := row.Scan(&idStr, &name, &prov, &model, &keyEnc, &sort, &created, &updated); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, sql.ErrNoRows
		}
		return nil, err
	}
	pid, _ := uuid.Parse(idStr)
	ct := parseFlexTime(created)
	ut := parseFlexTime(updated)
	plain, _ := r.decryptKey(keyEnc)
	return &domain.Profile{
		ID:           pid,
		DisplayName:  name,
		Provider:     prov,
		ModelID:      model,
		SortOrder:    sort,
		CreatedAt:    ct,
		UpdatedAt:    ut,
		APIKeyPlain:  strings.TrimSpace(plain),
		HasKeyCipher: len(keyEnc) > 0,
	}, nil
}

func (r *Repository) CreateProfile(ctx context.Context, displayName, provider, modelID string, sortOrder int, apiKeyPlain string) (uuid.UUID, error) {
	if err := r.ensureLLMSchema(ctx); err != nil {
		return uuid.Nil, err
	}
	id := uuid.New()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	key := mailcrypto.KeyForLLMProfile(r.Cfg)
	enc, err := mailcrypto.EncryptAES256GCM([]byte(strings.TrimSpace(apiKeyPlain)), key)
	if err != nil {
		return uuid.Nil, err
	}
	_, err = r.DB.ExecContext(ctx,
		`INSERT INTO laele_llm_profiles (id, display_name, provider, model_id, api_key_enc, sort_order, created_at, updated_at)
		 VALUES (?,?,?,?,?,?,?,?)`,
		id.String(), strings.TrimSpace(displayName), strings.TrimSpace(provider), strings.TrimSpace(modelID), enc, sortOrder, now, now,
	)
	return id, err
}

func (r *Repository) UpdateProfile(ctx context.Context, id uuid.UUID, displayName, modelID *string, sortOrder *int, apiKeyPlain *string) error {
	p, err := r.GetProfileByID(ctx, id)
	if err != nil {
		return err
	}
	name := p.DisplayName
	model := p.ModelID
	sort := p.SortOrder
	if displayName != nil {
		name = strings.TrimSpace(*displayName)
	}
	if modelID != nil {
		model = strings.TrimSpace(*modelID)
	}
	if sortOrder != nil {
		sort = *sortOrder
	}
	keyEnc := []byte{}
	if apiKeyPlain != nil && strings.TrimSpace(*apiKeyPlain) != "" {
		k := mailcrypto.KeyForLLMProfile(r.Cfg)
		enc, err := mailcrypto.EncryptAES256GCM([]byte(strings.TrimSpace(*apiKeyPlain)), k)
		if err != nil {
			return err
		}
		keyEnc = enc
		_, err = r.DB.ExecContext(ctx,
			`UPDATE laele_llm_profiles SET display_name=?, model_id=?, sort_order=?, api_key_enc=?, updated_at=? WHERE id=?`,
			name, model, sort, keyEnc, time.Now().UTC().Format(time.RFC3339Nano), id.String(),
		)
		return err
	}
	_, err = r.DB.ExecContext(ctx,
		`UPDATE laele_llm_profiles SET display_name=?, model_id=?, sort_order=?, updated_at=? WHERE id=?`,
		name, model, sort, time.Now().UTC().Format(time.RFC3339Nano), id.String(),
	)
	return err
}

func (r *Repository) DeleteProfile(ctx context.Context, id uuid.UUID) error {
	if err := r.ensureLLMSchema(ctx); err != nil {
		return err
	}
	_, err := r.DB.ExecContext(ctx, `DELETE FROM laele_llm_profiles WHERE id=?`, id.String())
	return err
}

func (r *Repository) GetAgentPrefs(ctx context.Context) (domain.AgentPrefs, error) {
	if err := r.ensureLLMSchema(ctx); err != nil {
		return domain.AgentPrefs{}, err
	}
	var mode, defID, updated string
	err := r.DB.QueryRowContext(ctx,
		`SELECT agent_mode, default_profile_id, updated_at FROM laele_llm_agent_prefs WHERE id='singleton'`,
	).Scan(&mode, &defID, &updated)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.AgentPrefs{AgentMode: "auto"}, nil
		}
		return domain.AgentPrefs{AgentMode: "auto"}, err
	}
	var def *uuid.UUID
	if strings.TrimSpace(defID) != "" {
		if u, err := uuid.Parse(defID); err == nil {
			def = &u
		}
	}
	ut := parseFlexTime(updated)
	return domain.AgentPrefs{AgentMode: mode, DefaultProfileID: def, UpdatedAt: ut}, nil
}

func (r *Repository) SetAgentPrefs(ctx context.Context, mode string, defaultProfileID *uuid.UUID) error {
	if err := r.ensureLLMSchema(ctx); err != nil {
		return err
	}
	var def any
	if defaultProfileID != nil {
		def = defaultProfileID.String()
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := r.DB.ExecContext(ctx, `
		INSERT INTO laele_llm_agent_prefs (id, agent_mode, default_profile_id, updated_at)
		VALUES ('singleton', ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			agent_mode = excluded.agent_mode,
			default_profile_id = excluded.default_profile_id,
			updated_at = excluded.updated_at
	`, mode, def, now)
	return err
}

func (r *Repository) HasConfiguredProvider(ctx context.Context, provider string) (bool, error) {
	if err := r.ensureLLMSchema(ctx); err != nil {
		return false, err
	}
	var n int
	err := r.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM laele_llm_profiles WHERE lower(provider)=lower(?) AND length(api_key_enc) > 0`,
		provider,
	).Scan(&n)
	return n > 0, err
}

func (r *Repository) HasAnyConfiguredProfile(ctx context.Context) (bool, error) {
	if err := r.ensureLLMSchema(ctx); err != nil {
		return false, err
	}
	var n int
	err := r.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM laele_llm_profiles WHERE length(api_key_enc) > 0`,
	).Scan(&n)
	return n > 0, err
}

func (r *Repository) FirstProfileWithKey(ctx context.Context) (*domain.Profile, error) {
	if err := r.ensureLLMSchema(ctx); err != nil {
		return nil, err
	}
	row := r.DB.QueryRowContext(ctx,
		`SELECT id FROM laele_llm_profiles WHERE length(api_key_enc) > 0 ORDER BY sort_order ASC, created_at ASC LIMIT 1`,
	)
	var idStr string
	if err := row.Scan(&idStr); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, sql.ErrNoRows
		}
		return nil, err
	}
	id, err := uuid.Parse(idStr)
	if err != nil {
		return nil, err
	}
	return r.GetProfileByID(ctx, id)
}

func (r *Repository) FirstProfileForProvider(ctx context.Context, provider string) (*domain.Profile, error) {
	if err := r.ensureLLMSchema(ctx); err != nil {
		return nil, err
	}
	row := r.DB.QueryRowContext(ctx,
		`SELECT id FROM laele_llm_profiles WHERE lower(provider)=lower(?) AND length(api_key_enc) > 0 ORDER BY sort_order ASC, created_at ASC LIMIT 1`,
		provider,
	)
	var idStr string
	if err := row.Scan(&idStr); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, sql.ErrNoRows
		}
		return nil, err
	}
	id, err := uuid.Parse(idStr)
	if err != nil {
		return nil, err
	}
	return r.GetProfileByID(ctx, id)
}
