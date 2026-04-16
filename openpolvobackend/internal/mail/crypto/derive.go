package crypto

import (
	"crypto/sha256"
	"strings"

	platformcfg "github.com/open-polvo/open-polvo/internal/platform/config"
)

// KeyForSMTPPassword deriva chave AES-256 a partir de SMTP_CREDENTIALS_KEY ou JWT_SECRET.
func KeyForSMTPPassword(cfg platformcfg.Config) []byte {
	if k := strings.TrimSpace(cfg.SMTPCredentialsKey); k != "" {
		sum := sha256.Sum256([]byte(k))
		return sum[:]
	}
	sum := sha256.Sum256([]byte("open-polvo:laele:smtp:v1:" + cfg.JWTSecret))
	return sum[:]
}
