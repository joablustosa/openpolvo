package mysql

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/social/domain"
	"github.com/open-polvo/open-polvo/internal/social/ports"
)

// ─── AutomationConfig ────────────────────────────────────────────────────────

type AutomationConfigRepository struct {
	DB *sql.DB
}

var _ ports.AutomationConfigRepository = (*AutomationConfigRepository)(nil)

func (r *AutomationConfigRepository) GetByUserID(ctx context.Context, userID uuid.UUID) (*domain.AutomationConfig, error) {
	row := r.DB.QueryRowContext(ctx,
		`SELECT id, user_id, platforms_json, sites_json, times_per_day, approval_phone, active, last_run_at, created_at, updated_at
		 FROM laele_social_automation_configs WHERE user_id = ?`, userID.String())
	return scanConfig(row)
}

func (r *AutomationConfigRepository) Upsert(ctx context.Context, cfg *domain.AutomationConfig) error {
	platforms, _ := json.Marshal(cfg.Platforms)
	sites, _ := json.Marshal(cfg.Sites)
	active := 0
	if cfg.Active {
		active = 1
	}
	now := time.Now().UTC()
	_, err := r.DB.ExecContext(ctx,
		`INSERT INTO laele_social_automation_configs
		   (id, user_id, platforms_json, sites_json, times_per_day, approval_phone, active, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE
		   platforms_json = VALUES(platforms_json),
		   sites_json = VALUES(sites_json),
		   times_per_day = VALUES(times_per_day),
		   approval_phone = VALUES(approval_phone),
		   active = VALUES(active),
		   updated_at = VALUES(updated_at)`,
		cfg.ID, cfg.UserID, string(platforms), string(sites),
		cfg.TimesPerDay, cfg.ApprovalPhone, active, now, now,
	)
	return err
}

func (r *AutomationConfigRepository) ListActive(ctx context.Context) ([]domain.AutomationConfig, error) {
	rows, err := r.DB.QueryContext(ctx,
		`SELECT id, user_id, platforms_json, sites_json, times_per_day, approval_phone, active, last_run_at, created_at, updated_at
		 FROM laele_social_automation_configs WHERE active = 1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.AutomationConfig
	for rows.Next() {
		cfg, err := scanConfigRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *cfg)
	}
	return out, rows.Err()
}

func (r *AutomationConfigRepository) TouchLastRun(ctx context.Context, id string, t time.Time) error {
	_, err := r.DB.ExecContext(ctx,
		`UPDATE laele_social_automation_configs SET last_run_at = ?, updated_at = ? WHERE id = ?`,
		t, t, id)
	return err
}

func scanConfig(row *sql.Row) (*domain.AutomationConfig, error) {
	var (
		id, userID, platJSON, sitesJSON, phone string
		timesPerDay, active                    int
		lastRun                                *time.Time
		createdAt, updatedAt                   time.Time
	)
	if err := row.Scan(&id, &userID, &platJSON, &sitesJSON, &timesPerDay, &phone, &active, &lastRun, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, sql.ErrNoRows
		}
		return nil, err
	}
	return buildConfig(id, userID, platJSON, sitesJSON, phone, timesPerDay, active, lastRun, createdAt, updatedAt), nil
}

func scanConfigRow(rows *sql.Rows) (*domain.AutomationConfig, error) {
	var (
		id, userID, platJSON, sitesJSON, phone string
		timesPerDay, active                    int
		lastRun                                *time.Time
		createdAt, updatedAt                   time.Time
	)
	if err := rows.Scan(&id, &userID, &platJSON, &sitesJSON, &timesPerDay, &phone, &active, &lastRun, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return buildConfig(id, userID, platJSON, sitesJSON, phone, timesPerDay, active, lastRun, createdAt, updatedAt), nil
}

func buildConfig(id, userID, platJSON, sitesJSON, phone string, timesPerDay, active int, lastRun *time.Time, createdAt, updatedAt time.Time) *domain.AutomationConfig {
	var platforms, sites []string
	_ = json.Unmarshal([]byte(platJSON), &platforms)
	_ = json.Unmarshal([]byte(sitesJSON), &sites)
	return &domain.AutomationConfig{
		ID:            id,
		UserID:        userID,
		Platforms:     platforms,
		Sites:         sites,
		TimesPerDay:   timesPerDay,
		ApprovalPhone: phone,
		Active:        active != 0,
		LastRunAt:     lastRun,
		CreatedAt:     createdAt,
		UpdatedAt:     updatedAt,
	}
}

// ─── SocialPost ──────────────────────────────────────────────────────────────

type SocialPostRepository struct {
	DB *sql.DB
}

var _ ports.SocialPostRepository = (*SocialPostRepository)(nil)

func (r *SocialPostRepository) Create(ctx context.Context, p *domain.SocialPost) error {
	hashJSON, _ := json.Marshal(p.Hashtags)
	now := time.Now().UTC()
	_, err := r.DB.ExecContext(ctx,
		`INSERT INTO laele_social_posts
		  (id, user_id, config_id, platform, title, description, hashtags_json,
		   image_url, image_prompt, source_url, source_title, status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.ID, p.UserID, p.ConfigID, p.Platform, p.Title, p.Description, string(hashJSON),
		nullStr(p.ImageURL), nullStr(p.ImagePrompt), nullStr(p.SourceURL), nullStr(p.SourceTitle),
		string(p.Status), now, now,
	)
	return err
}

func (r *SocialPostRepository) GetByID(ctx context.Context, id string) (*domain.SocialPost, error) {
	row := r.DB.QueryRowContext(ctx, selectPostSQL+" WHERE id = ?", id)
	return scanPost(row.Scan)
}

func (r *SocialPostRepository) UpdateStatus(ctx context.Context, id string, status domain.PostStatus, extra map[string]any) error {
	now := time.Now().UTC()
	q := "UPDATE laele_social_posts SET status = ?, updated_at = ?"
	args := []any{string(status), now}
	if v, ok := extra["published_post_id"]; ok {
		q += ", published_post_id = ?"
		args = append(args, v)
	}
	if v, ok := extra["error_msg"]; ok {
		q += ", error_msg = ?"
		args = append(args, v)
	}
	if v, ok := extra["approval_sent_at"]; ok {
		q += ", approval_sent_at = ?"
		args = append(args, v)
	}
	if v, ok := extra["approved_at"]; ok {
		q += ", approved_at = ?"
		args = append(args, v)
	}
	if v, ok := extra["published_at"]; ok {
		q += ", published_at = ?"
		args = append(args, v)
	}
	q += " WHERE id = ?"
	args = append(args, id)
	_, err := r.DB.ExecContext(ctx, q, args...)
	return err
}

func (r *SocialPostRepository) ListByUserID(ctx context.Context, userID uuid.UUID, limit int) ([]domain.SocialPost, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := r.DB.QueryContext(ctx,
		selectPostSQL+" WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
		userID.String(), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.SocialPost
	for rows.Next() {
		p, err := scanPost(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

func (r *SocialPostRepository) GetPendingApprovalByUser(ctx context.Context, userID uuid.UUID) (*domain.SocialPost, error) {
	row := r.DB.QueryRowContext(ctx,
		selectPostSQL+" WHERE user_id = ? AND status = 'pending_approval' ORDER BY created_at DESC LIMIT 1",
		userID.String())
	return scanPost(row.Scan)
}

const selectPostSQL = `SELECT id, user_id, config_id, platform, title, description, hashtags_json,
  COALESCE(image_url,''), COALESCE(image_prompt,''), COALESCE(source_url,''), COALESCE(source_title,''),
  status, COALESCE(published_post_id,''), approval_sent_at, approved_at, published_at,
  COALESCE(error_msg,''), created_at, updated_at
 FROM laele_social_posts`

func scanPost(scan func(...any) error) (*domain.SocialPost, error) {
	var (
		id, userID, configID, platform, title, desc, hashJSON string
		imageURL, imagePrompt, sourceURL, sourceTitle          string
		status, pubPostID, errMsg                              string
		approvalSent, approvedAt, publishedAt                  *time.Time
		createdAt, updatedAt                                   time.Time
	)
	err := scan(&id, &userID, &configID, &platform, &title, &desc, &hashJSON,
		&imageURL, &imagePrompt, &sourceURL, &sourceTitle,
		&status, &pubPostID, &approvalSent, &approvedAt, &publishedAt,
		&errMsg, &createdAt, &updatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, sql.ErrNoRows
		}
		return nil, err
	}
	var hashtags []string
	_ = json.Unmarshal([]byte(hashJSON), &hashtags)
	return &domain.SocialPost{
		ID:              id,
		UserID:          userID,
		ConfigID:        configID,
		Platform:        platform,
		Title:           title,
		Description:     desc,
		Hashtags:        hashtags,
		ImageURL:        imageURL,
		ImagePrompt:     imagePrompt,
		SourceURL:       sourceURL,
		SourceTitle:     sourceTitle,
		Status:          domain.PostStatus(status),
		PublishedPostID: pubPostID,
		ApprovalSentAt:  approvalSent,
		ApprovedAt:      approvedAt,
		PublishedAt:     publishedAt,
		ErrorMsg:        errMsg,
		CreatedAt:       createdAt,
		UpdatedAt:       updatedAt,
	}, nil
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
