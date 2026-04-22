package application

import (
	"context"
	"strings"

	"github.com/google/uuid"

	"github.com/open-polvo/open-polvo/internal/social/domain"
	"github.com/open-polvo/open-polvo/internal/social/ports"
)

type ListSocialPosts struct {
	Posts ports.SocialPostRepository
}

type SocialPostDTO struct {
	ID              string   `json:"id"`
	Platform        string   `json:"platform"`
	Title           string   `json:"title"`
	Description     string   `json:"description"`
	Hashtags        []string `json:"hashtags"`
	ImageURL        string   `json:"image_url,omitempty"`
	SourceURL       string   `json:"source_url,omitempty"`
	SourceTitle     string   `json:"source_title,omitempty"`
	Status          string   `json:"status"`
	PublishedPostID string   `json:"published_post_id,omitempty"`
	ErrorMsg        string   `json:"error_msg,omitempty"`
	ApprovalSentAt  *string  `json:"approval_sent_at,omitempty"`
	ApprovedAt      *string  `json:"approved_at,omitempty"`
	PublishedAt     *string  `json:"published_at,omitempty"`
	CreatedAtISO    string   `json:"created_at"`
}

func (uc *ListSocialPosts) Execute(ctx context.Context, userID uuid.UUID, limit int) ([]SocialPostDTO, error) {
	posts, err := uc.Posts.ListByUserID(ctx, userID, limit)
	if err != nil {
		return nil, err
	}
	out := make([]SocialPostDTO, 0, len(posts))
	for _, p := range posts {
		out = append(out, toPostDTO(p))
	}
	return out, nil
}

func toPostDTO(p domain.SocialPost) SocialPostDTO {
	dto := SocialPostDTO{
		ID:              p.ID,
		Platform:        p.Platform,
		Title:           p.Title,
		Description:     p.Description,
		Hashtags:        p.Hashtags,
		ImageURL:        p.ImageURL,
		SourceURL:       p.SourceURL,
		SourceTitle:     p.SourceTitle,
		Status:          string(p.Status),
		PublishedPostID: p.PublishedPostID,
		ErrorMsg:        p.ErrorMsg,
		CreatedAtISO:    p.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z07:00"),
	}
	if dto.Hashtags == nil {
		dto.Hashtags = []string{}
	}
	if p.ApprovalSentAt != nil {
		s := p.ApprovalSentAt.UTC().Format("2006-01-02T15:04:05.000Z07:00")
		dto.ApprovalSentAt = &s
	}
	if p.ApprovedAt != nil {
		s := p.ApprovedAt.UTC().Format("2006-01-02T15:04:05.000Z07:00")
		dto.ApprovedAt = &s
	}
	if p.PublishedAt != nil {
		s := p.PublishedAt.UTC().Format("2006-01-02T15:04:05.000Z07:00")
		dto.PublishedAt = &s
	}
	_ = strings.TrimSpace // usado em outros ficheiros do pacote
	return dto
}
