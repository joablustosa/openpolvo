-- Executar na base MySQL se a API falhar com:
--   "Dirty database version 2. Fix and force version."
-- Isto aconteceu quando a migração 000002 continha dois CREATE no mesmo ficheiro.
--
-- 1) Se a tabela laele_conversations NÃO existir, apague o registo da versão 2:
--    DELETE FROM schema_migrations WHERE version = 2;
--
-- 2) Se laele_conversations JÁ existir (primeiro CREATE tinha corrido), limpe só o dirty:
UPDATE schema_migrations SET dirty = 0 WHERE version = 2;

-- Depois volte a arrancar a API (migrate up aplica 000003 se ainda não estiver).
