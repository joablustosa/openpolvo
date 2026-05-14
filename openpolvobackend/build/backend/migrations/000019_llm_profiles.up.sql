-- Perfis LLM (chaves cifradas) e preferências do agente local

CREATE TABLE IF NOT EXISTS laele_llm_profiles (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  display_name TEXT NOT NULL,
  provider VARCHAR(16) NOT NULL,
  model_id VARCHAR(128) NOT NULL,
  api_key_enc BLOB NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_laele_llm_profiles_sort ON laele_llm_profiles (sort_order, created_at);

CREATE TABLE IF NOT EXISTS laele_llm_agent_prefs (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  agent_mode VARCHAR(16) NOT NULL DEFAULT 'auto',
  default_profile_id VARCHAR(36) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (default_profile_id) REFERENCES laele_llm_profiles(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO laele_llm_agent_prefs (id, agent_mode, updated_at) VALUES ('singleton', 'auto', CURRENT_TIMESTAMP(3));
