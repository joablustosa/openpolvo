package config

import (
	"fmt"
	"net/url"
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
	MYSQLDSN            string
	RunMigrations       bool
	MigrationsPath      string
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
	// Timeout para chamadas HTTP ao Intelligence e ao LLM remoto.
	AgentLLMTimeout       time.Duration
	// Chave opcional (string qualquer) para AES-256-GCM da password SMTP por utilizador; se vazia usa derivação a partir de JWT_SECRET.
	SMTPCredentialsKey string
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
		SMTPCredentialsKey: strings.TrimSpace(os.Getenv("SMTP_CREDENTIALS_KEY")),
		OpenAIAPIKey:          strings.TrimSpace(os.Getenv("OPENAI_API_KEY")),
		GoogleAPIKey:          strings.TrimSpace(os.Getenv("GOOGLE_API_KEY")),
		OpenAIModel:           getEnv("OPENAI_MODEL", "gpt-4o-mini"),
		GoogleModel:           getEnv("GOOGLE_MODEL", "gemini-2.0-flash"),
		BootstrapDefaultAdmin: parseBool(getEnv("BOOTSTRAP_DEFAULT_ADMIN", "true")),
		DefaultAdminEmail:     getEnv("DEFAULT_ADMIN_EMAIL", "admin@openlaele.local"),
		DefaultAdminPassword:  defaultAdminPasswordFromEnv(),
	}

	ttl, err := time.ParseDuration(getEnv("JWT_ACCESS_TTL", "15m"))
	if err != nil {
		return Config{}, fmt.Errorf("JWT_ACCESS_TTL: %w", err)
	}
	cfg.JWTAccessTTL = ttl

	llmTO, err := time.ParseDuration(getEnv("AGENT_LLM_TIMEOUT", "120s"))
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
	// Compat: permitir usar GOOGLE_OAUTH_CLIENT_ID singular.
	if len(cfg.GoogleOAuthClientIDs) == 0 {
		if v := strings.TrimSpace(os.Getenv("GOOGLE_OAUTH_CLIENT_ID")); v != "" {
			cfg.GoogleOAuthClientIDs = []string{v}
		}
	}
	dsn, err := resolveMySQLDSN()
	if err != nil {
		return Config{}, err
	}
	cfg.MYSQLDSN = dsn
	return cfg, nil
}

func getEnv(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func defaultAdminPasswordFromEnv() string {
	if _, set := os.LookupEnv("DEFAULT_ADMIN_PASSWORD"); !set {
		return "OpenLaEleAdmin123!"
	}
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

func resolveMySQLDSN() (string, error) {
	raw := strings.TrimSpace(os.Getenv("MYSQL_DSN"))
	raw = trimQuotes(raw)
	if raw != "" {
		return raw, nil
	}
	host := strings.TrimSpace(os.Getenv("MYSQL_HOST"))
	user := strings.TrimSpace(os.Getenv("MYSQL_USER"))
	db := strings.TrimSpace(os.Getenv("MYSQL_DATABASE"))
	pass := strings.TrimSpace(os.Getenv("MYSQL_PASSWORD"))
	port := strings.TrimSpace(os.Getenv("MYSQL_PORT"))
	if port == "" {
		port = "3306"
	}
	if host == "" || user == "" || db == "" {
		return "", fmt.Errorf("define MYSQL_DSN ou MYSQL_HOST, MYSQL_USER, MYSQL_DATABASE (e MYSQL_PASSWORD se necessário)")
	}
	tls := false
	if v := strings.TrimSpace(os.Getenv("MYSQL_TLS")); v != "" {
		tls = parseBool(v)
	} else if strings.Contains(strings.ToLower(host), ".mysql.database.azure.com") {
		tls = true
	}
	ui := url.UserPassword(user, pass)
	if ui == nil {
		return "", fmt.Errorf("MYSQL_USER inválido")
	}
	q := "parseTime=true&charset=utf8mb4"
	if tls {
		q += "&tls=true"
	}
	return fmt.Sprintf("%s@tcp(%s:%s)/%s?%s", ui.String(), host, port, db, q), nil
}

func trimQuotes(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 {
		if (s[0] == '"' && s[len(s)-1] == '"') || (s[0] == '\'' && s[len(s)-1] == '\'') {
			return strings.TrimSpace(s[1 : len(s)-1])
		}
	}
	return s
}
