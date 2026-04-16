package domain

import "time"

// UserSMTPSettings dados persistidos (password em claro só em memória durante envio).
type UserSMTPSettings struct {
	UserID    string
	Host      string
	Port      int
	Username  string
	Password  string
	FromEmail string
	FromName  string
	UseTLS    bool
	UpdatedAt time.Time
}

// SMTPRecord linha completa da BD (cipher da password).
type SMTPRecord struct {
	UserSMTPSettings
	PasswordCipher []byte
}
