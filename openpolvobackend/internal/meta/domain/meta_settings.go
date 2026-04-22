package domain

import "time"

// UserMetaSettings configuração da integração Meta por utilizador (tokens em claro só em memória).
type UserMetaSettings struct {
	UserID string

	AppID     string
	AppSecret string

	// WhatsApp Business Cloud API
	WAPhoneNumberID  string
	WAAccessToken    string

	// Facebook Page
	FBPageID         string
	FBPageToken      string

	// Instagram Business
	IGAccountID      string
	IGAccessToken    string

	// Token que o servidor envia ao registar o webhook no painel Meta.
	WebhookVerifyToken string

	UpdatedAt time.Time
}

// MetaRecord linha completa da BD (tokens cifrados).
type MetaRecord struct {
	UserMetaSettings
	AppSecretEnc      []byte
	WAAccessTokenEnc  []byte
	FBPageTokenEnc    []byte
	IGAccessTokenEnc  []byte
}

// WhatsAppConfigured indica se o utilizador tem WhatsApp configurado.
func (s *UserMetaSettings) WhatsAppConfigured() bool {
	return s.WAPhoneNumberID != "" && s.WAAccessToken != ""
}

// FacebookConfigured indica se o utilizador tem página de Facebook configurada.
func (s *UserMetaSettings) FacebookConfigured() bool {
	return s.FBPageID != "" && s.FBPageToken != ""
}

// InstagramConfigured indica se o utilizador tem Instagram configurado.
func (s *UserMetaSettings) InstagramConfigured() bool {
	return s.IGAccountID != "" && s.IGAccessToken != ""
}
