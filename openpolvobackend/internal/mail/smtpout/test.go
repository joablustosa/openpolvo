package smtpout

import (
	"context"
	"crypto/tls"
	"fmt"
	"net/smtp"
)

// TestConnection verifica credenciais SMTP (ligação + autenticação) sem enviar nenhuma mensagem.
// Útil para validar a configuração antes de tentar enviar.
func TestConnection(ctx context.Context, dial DialConfig, host string, port int, username, password string, useTLS bool) error {
	addr := fmt.Sprintf("%s:%d", host, port)
	tlsConf := &tls.Config{ServerName: host}
	nd := dial.Normalized()
	dialer := nd.dialer()
	netw := nd.Network

	var c *smtp.Client

	if port == 465 {
		conn, err := tls.DialWithDialer(dialer, netw, addr, tlsConf)
		if err != nil {
			return fmt.Errorf("smtp tls dial: %w", err)
		}
		var cerr error
		c, cerr = smtp.NewClient(conn, host)
		if cerr != nil {
			conn.Close()
			return fmt.Errorf("smtp client: %w", cerr)
		}
	} else {
		conn, err := dialer.DialContext(ctx, netw, addr)
		if err != nil {
			return fmt.Errorf("smtp dial: %w", err)
		}
		var cerr error
		c, cerr = smtp.NewClient(conn, host)
		if cerr != nil {
			conn.Close()
			return fmt.Errorf("smtp client: %w", cerr)
		}
		if useTLS {
			if ok, _ := c.Extension("STARTTLS"); ok {
				if err := c.StartTLS(tlsConf); err != nil {
					c.Close()
					return fmt.Errorf("smtp starttls: %w", err)
				}
			}
		}
	}
	defer c.Close()

	if username != "" {
		auth := smtp.PlainAuth("", username, password, host)
		if err := c.Auth(auth); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}
	return c.Quit()
}
