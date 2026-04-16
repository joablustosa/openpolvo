package ports

// SMTPContext metadados da conta SMTP do utilizador (sem password) enviados ao orquestrador Intelligence.
type SMTPContext struct {
	Configured bool   `json:"configured"`
	FromEmail  string `json:"from_email,omitempty"`
	FromName   string `json:"from_name,omitempty"`
	Host       string `json:"host,omitempty"`
	Port       int    `json:"port,omitempty"`
	UseTLS     bool   `json:"use_tls"`
}
