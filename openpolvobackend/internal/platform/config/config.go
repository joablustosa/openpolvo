package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"

	"github.com/open-polvo/open-polvo/internal/platform/repo"
)

type Config struct {
	HTTPAddr            string
	CORSAllowedOrigins  []string
	CORSAllowNullOrigin bool
	JWTSecret           string
	JWTIssuer           string
	JWTAccessTTL        time.Duration
	// Base de dados (driver + DSN). Em produção, usar MySQL.
	DBDriver string // mysql | sqlite
	// DSN do MySQL (ex.: user:pass@tcp(host:3306)/dbname?parseTime=true&multiStatements=true)
	DBDSN string
	// Base de dados SQLite local (apenas quando DBDriver=sqlite).
	DBPath string
	RunMigrations bool
	MigrationsPath string
	AuthAllowRegister   bool
	// OAuth (Google) — usado para login/cadastro via conta Google (ID token).
	GoogleOAuthClientIDs []string
	// Open Polvo Intelligence (Python + LangGraph). URL base sem barra final e chave interna (header X-Open-Polvo-Internal-Key).
	PolvoIntelligenceBaseURL     string
	PolvoIntelligenceInternalKey string
	// Legado: chaves no processo Go (já não usadas pelo agente; configure no serviço Python).
	OpenAIAPIKey string
	GoogleAPIKey string
	OpenAIModel  string
	GoogleModel  string
	// Modelos dedicados a POST /v1/audio/transcribe (multimodal / Whisper).
	OpenAITranscribeModel  string
	GeminiTranscribeModel  string
	// Timeout para chamadas HTTP ao Intelligence e ao LLM remoto.
	AgentLLMTimeout       time.Duration
	// Chave opcional (string qualquer) para AES-256-GCM da password SMTP por utilizador; se vazia usa derivação a partir de JWT_SECRET.
	SMTPCredentialsKey string
	// Chave opcional para AES-256-GCM dos tokens Meta; se vazia usa derivação a partir de JWT_SECRET.
	MetaCredentialsKey string
	// Token de verificação de webhook Meta (hub.verify_token); configurado no painel da Meta App.
	MetaWebhookVerifyToken string
	// Ligação TCP/TLS aos servidores SMTP dos utilizadores (teste e envio).
	SMTPDialTimeout time.Duration
	SMTPDialNetwork string // tcp | tcp4 | tcp6
	BootstrapDefaultAdmin bool
	DefaultAdminEmail     string
	DefaultAdminPassword  string
}

func Load() (Config, error) {
	if modRoot, err := repo.ModuleRoot(); err == nil {
		_ = godotenv.Load(filepath.Join(modRoot, ".env"))
	}
	_ = godotenv.Overload()

	cfg := Config{
		HTTPAddr: getEnv("HTTP_ADDR", ":8080"),
		CORSAllowedOrigins: splitComma(getEnv(
			"CORS_ALLOWED_ORIGINS",
			"http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174",
		)),
		CORSAllowNullOrigin:  parseBool(getEnv("CORS_ALLOW_NULL_ORIGIN", "true")),
		JWTSecret:            strings.TrimSpace(os.Getenv("JWT_SECRET")),
		JWTIssuer:            getEnv("JWT_ISSUER", "open-polvo"),
		DBDriver:             strings.ToLower(strings.TrimSpace(getEnv("DB_DRIVER", "mysql"))),
		DBDSN:                strings.TrimSpace(firstNonEmpty(os.Getenv("DB_DSN"), os.Getenv("DATABASE_URL"))),
		DBPath:               getEnv("DB_PATH", "openpolvo.db"),
		RunMigrations:        parseBool(getEnv("RUN_MIGRATIONS", "true")),
		MigrationsPath:       getEnv("MIGRATIONS_PATH", "migrations"),
		AuthAllowRegister:    parseBool(getEnv("AUTH_ALLOW_REGISTER", "false")),
		GoogleOAuthClientIDs: splitComma(getEnv("GOOGLE_OAUTH_CLIENT_IDS", "")),
		PolvoIntelligenceBaseURL: strings.TrimSpace(os.Getenv(
			"POLVO_INTELLIGENCE_BASE_URL",
		)),
		PolvoIntelligenceInternalKey: strings.TrimSpace(os.Getenv(
			"POLVO_INTELLIGENCE_INTERNAL_KEY",
		)),
		SMTPCredentialsKey:     strings.TrimSpace(os.Getenv("SMTP_CREDENTIALS_KEY")),
		MetaCredentialsKey:     strings.TrimSpace(os.Getenv("META_CREDENTIALS_KEY")),
		MetaWebhookVerifyToken: strings.TrimSpace(os.Getenv("META_WEBHOOK_VERIFY_TOKEN")),
		OpenAIAPIKey:          strings.TrimSpace(os.Getenv("OPENAI_API_KEY")),
		GoogleAPIKey:          strings.TrimSpace(os.Getenv("GOOGLE_API_KEY")),
		OpenAIModel:           getEnv("OPENAI_MODEL", "gpt-4o-mini"),
		GoogleModel:           getEnv("GOOGLE_MODEL", "gemini-2.0-flash"),
		OpenAITranscribeModel: getEnv("OPENAI_TRANSCRIBE_MODEL", "whisper-1"),
		GeminiTranscribeModel: getEnv("GEMINI_TRANSCRIBE_MODEL", "gemini-2.5-flash"),
		BootstrapDefaultAdmin: parseBool(getEnv("BOOTSTRAP_DEFAULT_ADMIN", "true")),
		DefaultAdminEmail:     getEnv("DEFAULT_ADMIN_EMAIL", "admin@openlaele.local"),
		DefaultAdminPassword:  defaultAdminPasswordFromEnv(),
	}

	ttl, err := time.ParseDuration(getEnv("JWT_ACCESS_TTL", "15m"))
	if err != nil {
		return Config{}, fmt.Errorf("JWT_ACCESS_TTL: %w", err)
	}
	cfg.JWTAccessTTL = ttl

	// O sub-grafo Builder pode correr 4 LLM calls encadeadas com outputs grandes; 600s cobre o pior caso com margem.
	llmTO, err := time.ParseDuration(getEnv("AGENT_LLM_TIMEOUT", "600s"))
	if err != nil {
		return Config{}, fmt.Errorf("AGENT_LLM_TIMEOUT: %w", err)
	}
	cfg.AgentLLMTimeout = llmTO

	smtpDialTO, err := time.ParseDuration(getEnv("SMTP_DIAL_TIMEOUT", "30s"))
	if err != nil {
		return Config{}, fmt.Errorf("SMTP_DIAL_TIMEOUT: %w", err)
	}
	cfg.SMTPDialTimeout = smtpDialTO

	smtpNet := strings.TrimSpace(strings.ToLower(os.Getenv("SMTP_DIAL_NETWORK")))
	if smtpNet == "" && parseBool(getEnv("SMTP_PREFER_IPV4", "false")) {
		smtpNet = "tcp4"
	}
	switch smtpNet {
	case "":
		cfg.SMTPDialNetwork = "tcp"
	case "tcp", "tcp4", "tcp6":
		cfg.SMTPDialNetwork = smtpNet
	default:
		return Config{}, fmt.Errorf("SMTP_DIAL_NETWORK must be tcp, tcp4 or tcp6")
	}

	if cfg.JWTSecret == "" {
		return Config{}, fmt.Errorf("JWT_SECRET is required")
	}

	switch cfg.DBDriver {
	case "", "mysql":
		cfg.DBDriver = "mysql"
		if strings.TrimSpace(cfg.DBDSN) == "" {
			return Config{}, fmt.Errorf("DB_DSN (or DATABASE_URL) is required when DB_DRIVER=mysql")
		}
	case "sqlite":
		// DB_PATH usado
	default:
		return Config{}, fmt.Errorf("DB_DRIVER must be mysql or sqlite")
	}
	// Compat: permitir usar GOOGLE_OAUTH_CLIENT_ID singular.
	if len(cfg.GoogleOAuthClientIDs) == 0 {
		if v := strings.TrimSpace(os.Getenv("GOOGLE_OAUTH_CLIENT_ID")); v != "" {
			cfg.GoogleOAuthClientIDs = []string{v}
		}
	}
	return cfg, nil
}

func getEnv(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func defaultAdminPasswordFromEnv() string {
	return strings.TrimSpace(os.Getenv("DEFAULT_ADMIN_PASSWORD"))
}

func parseBool(s string) bool {
	b, err := strconv.ParseBool(s)
	return err == nil && b
}

func splitComma(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
