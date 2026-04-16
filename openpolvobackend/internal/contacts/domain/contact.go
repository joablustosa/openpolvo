package domain

import "time"

// Contact registo de contacto do utilizador (agenda para e-mail e automações).
type Contact struct {
	ID        string
	UserID    string
	Name      string
	Phone     string
	Email     string
	CreatedAt time.Time
	UpdatedAt time.Time
}
