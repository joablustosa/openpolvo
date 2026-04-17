package smtpout

import (
	"net"
	"strings"
	"time"
)

const defaultSMTPDialTimeout = 30 * time.Second

// DialConfig controla a ligação TCP/TLS ao servidor SMTP (timeout e família de endereços).
type DialConfig struct {
	Timeout time.Duration
	// Network é passado a net.Dialer / tls.DialWithDialer: "tcp" (defeito), "tcp4" ou "tcp6".
	Network string
}

// Normalized devolve uma cópia com valores seguros por defeito.
func (d DialConfig) Normalized() DialConfig {
	if d.Timeout <= 0 {
		d.Timeout = defaultSMTPDialTimeout
	}
	switch n := strings.TrimSpace(strings.ToLower(d.Network)); n {
	case "tcp4", "tcp6":
		d.Network = n
	case "tcp", "":
		d.Network = "tcp"
	default:
		d.Network = "tcp"
	}
	return d
}

func (d DialConfig) dialer() *net.Dialer {
	n := d.Normalized()
	return &net.Dialer{Timeout: n.Timeout}
}
