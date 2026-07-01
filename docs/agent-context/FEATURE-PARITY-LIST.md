# Lista completa de funcionalidades — paridade com Claude (títulos)

> Só títulos, ordenados da funcionalidade **mais importante** para a **menos importante**,
> em três categorias: Agente Geral, Workflows/Automações e Agente de Desenvolvimento.
> Base: capacidades do Claude Code + estado do OpenPolvo. Última revisão: 2026-07-01.

## A. Agente Geral

1. Loop agentico (ReAct) com tool-calling
2. Streaming de resposta e eventos em tempo real (SSE)
3. Ferramentas de sistema de ficheiros (ler / escrever / editar / multi-edit)
4. Execução de terminal/shell com confirmação
5. Busca no código (grep / glob / semantic search)
6. Edição por diff/patch com aceitar-rejeitar por hunk
7. Gestão automática de contexto (compactação / sumarização)
8. Memória persistente entre sessões (projeto / utilizador)
9. Gate de aprovação para ações sensíveis (permissões)
10. Interromper e retomar turnos (cancel / resume)
11. Multi-modelo com roteamento e fallback (local + keys)
12. Regras de projeto injetadas no contexto (AGENTS.md / CLAUDE.md / skills)
13. Pesquisa na web e fetch de URL como ferramenta
14. @-mentions de contexto (@ficheiro / @pasta / @símbolo / @url)
15. Integração MCP (conectar servidores externos)
16. Sub-agentes e delegação de tarefas
17. Planeamento com lista de tarefas visível (plan mode / to-dos)
18. Checkpoints e desfazer por edição
19. Histórico de sessões e retomar contexto
20. Entrada multimodal (imagens / screenshots)
21. Slash commands e comandos personalizados
22. Hooks (automações pré/pós ação do harness)
23. Configuração de permissões (allow / deny lists)
24. Contagem de custo e uso de tokens por turno
25. Renderização rica (markdown, tabelas, código, diagramas)
26. Notificações (fim de tarefa, aprovação pendente)
27. Guardrails de segurança (recusa de uso malicioso)
28. Observabilidade (traços, logs, telemetria)
29. Suporte multi-idioma

## B. Workflows / Automações

1. Criação de automação por linguagem natural (NL → grafo)
2. Serviço de execução agendada (scheduler + fila)
3. Agendamento recorrente (cron / intervalo / timezone)
4. Editor visual de grafo (canvas de nós e arestas)
5. Nós de ação essenciais (pesquisa web, e-mail, HTTP, LLM)
6. Configuração de credenciais integrada (SMTP, API keys)
7. Passagem de dados entre nós (variáveis / outputs / templates)
8. Templates prontos em 1 clique (ex.: Pesquisa → E-mail)
9. Execução manual (run now) e histórico de execuções
10. Logs por passo e observabilidade da execução
11. Tratamento de erro e retry por passo
12. Ramos condicionais e branching (if / else)
13. Aprovação humana no meio do fluxo (human-in-the-loop)
14. Gatilhos por evento (webhook, e-mail recebido, ficheiro)
15. Nós de integração (Slack, GitHub, Google, redes sociais)
16. Segredos e variáveis de ambiente por workflow
17. Notificações de sucesso / falha da automação
18. Simulação / dry-run e pré-visualização
19. Versionamento, duplicação e edição de workflows
20. Limites, quotas e concorrência
21. Partilha, exportação e importação de workflows
22. Galeria / marketplace de templates

## C. Agente de Desenvolvimento

1. Team de agentes especializados (architect / frontend / backend / …)
2. Bug-fix team (detectar → corrigir → verificar)
3. Self-healing / auto-reparação (corrective loop)
4. Portão de qualidade: build / typecheck / testes em sandbox
5. Execução de testes e leitura de resultados no loop
6. Edição multi-ficheiro coordenada
7. Indexação e RAG de código (semantic search)
8. Symbol graph / análise AST / análise de impacto
9. Planeamento de tarefas multi-passo
10. Integração git (branch / commit / push / pull)
11. Integração GitHub (PR / issues / checks)
12. Memória de erros (erro → fix) e aprendizagem por projeto
13. Diagnósticos LSP em tempo real como sinal para o agente
14. Geração de projeto novo (scaffold por stack)
15. Refactor automatizado em larga escala
16. Migrations e gestão de dependências
17. Explicação de código e Q&A sobre a base
18. Geração e atualização de testes / cobertura
19. Preview e execução da app (run + screenshot)
20. PR review automatizado (comentar diffs / sugerir fixes)
21. Autocomplete preditivo (estilo Cursor Tab)
22. Geração e atualização de documentação
23. Revisão de segurança (security review)
24. Otimização de performance (profiling)
25. Onboarding automático (init / gerar CLAUDE.md)
26. Design-to-code e tokens de UX
27. Suporte multi-stack e multi-linguagem
28. Checkpoints e rollback de mudanças de código
