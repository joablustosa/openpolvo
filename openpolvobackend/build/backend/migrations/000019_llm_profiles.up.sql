-- Perfis LLM (chaves cifradas) e preferências do agente local

CREATE TABLE IF NOT EXISTS laele_llm_profiles (
  id TEXT NOT NULL PRIMARY KEY,
  display_name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('openai','google')),
  model_id TEXT NOT NULL,
  api_key_enc BLOB NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_laele_llm_profiles_sort ON laele_llm_profiles (sort_order, created_at);

CREATE TABLE IF NOT EXISTS laele_llm_agent_prefs (
  id TEXT NOT NULL PRIMARY KEY CHECK (id = 'singleton'),
  agent_mode TEXT NOT NULL DEFAULT 'auto' CHECK (agent_mode IN ('auto','profile')),
  default_profile_id TEXT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (default_profile_id) REFERENCES laele_llm_profiles(id) ON DELETE SET NULL
);
INSERT OR IGNORE INTO laele_llm_agent_prefs (id, agent_mode, updated_at) VALUES ('singleton', 'auto', datetime('now'));
