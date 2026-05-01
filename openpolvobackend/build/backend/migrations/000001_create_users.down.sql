-- Política Open Polvo: `down` não apaga dados nem tabelas.
-- O arranque da API só executa migrações `up` pendentes; este ficheiro só corre com `migrate down` explícito.
-- Reverter schema: criar uma nova migração `up` (forward-only recomendado em produção).
SELECT 1;
