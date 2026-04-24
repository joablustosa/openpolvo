package crypto

import (
	"crypto/sha256"

	platformcfg "github.com/open-polvo/open-polvo/internal/platform/config"
)

// KeyForLLMProfile deriva chave AES-256 para cifrar API keys de perfis LLM (SQLite local).
func KeyForLLMProfile(cfg platformcfg.Config) []byte {
	sum := sha256.Sum256([]byte("open-polvo:laele:llm-profile:v1:" + cfg.JWTSecret))
	return sum[:]
}
