package ports

// ContactBrief enviado ao Intelligence para o agente reconhecer destinatários guardados.
type ContactBrief struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Phone string `json:"phone,omitempty"`
	Email string `json:"email"`
}
