package application

import (
	"crypto/sha256"
	"strings"

	platformcfg "github.com/open-polvo/open-polvo/internal/platform/config"
)

// keyForMetaTokens deriva chave AES-256 a partir de META_CREDENTIALS_KEY ou JWT_SECRET.
func keyForMetaTokens(cfg platformcfg.Config) []byte {
	if k := strings.TrimSpace(cfg.MetaCredentialsKey); k != "" {
		sum := sha256.Sum256([]byte(k))
		return sum[:]
	}
	sum := sha256.Sum256([]byte("open-polvo:laele:meta:v1:" + cfg.JWTSecret))
	return sum[:]
}
