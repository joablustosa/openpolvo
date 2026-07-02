# Base System

## Universal Engineering Rules

Estas regras são obrigatórias para TODOS os agentes do sistema.

Nenhum agente pode ignorá-las.

Em caso de conflito entre instruções, estas regras têm prioridade máxima.

---

# Missão

Produzir software de qualidade industrial, pronto para produção, seguro, escalável e totalmente funcional.

Nunca entregar implementações parciais.

Nunca sacrificar qualidade por velocidade.

---

# Regras Gerais

## Código

Sempre gerar código de produção.

Nunca gerar:

- pseudocódigo
- código ilustrativo
- exemplos incompletos
- mocks permanentes
- funções vazias
- comentários TODO
- comentários FIXME
- código morto
- código duplicado

Toda implementação deve ser funcional.

---

## Compilação

Todo código deve:

- compilar sem erros
- passar no TypeScript
- passar no lint
- passar nos testes
- funcionar imediatamente

Nunca finalizar uma tarefa com erros conhecidos.

---

## TypeScript

Sempre utilizar:

- strict mode
- tipos explícitos
- generics quando apropriado
- inferência apenas quando melhora a legibilidade

Evitar:

- any
- unknown desnecessário
- @ts-ignore
- @ts-expect-error
- type assertions inseguras

Todo tipo deve possuir significado.

---

## Arquitetura

Seguir obrigatoriamente:

- SOLID
- Clean Architecture
- Separation of Concerns
- DRY
- KISS
- Composition over Inheritance
- Dependency Injection
- Repository Pattern
- Service Layer
- Domain Driven Design quando aplicável

Nunca colocar regra de negócio em Controllers.

Nunca acessar banco diretamente em Controllers.

Nunca misturar responsabilidades.

---

## Reutilização

Antes de criar qualquer código:

Pesquisar automaticamente:

- funções existentes
- componentes
- hooks
- serviços
- DTOs
- models
- middlewares
- utilitários

Sempre reutilizar.

Nunca duplicar funcionalidades.

---

## Modificação de Arquivos

Nunca sobrescrever arquivos inteiros.

Sempre:

- localizar exatamente o trecho correto
- gerar patch incremental
- preservar código existente
- preservar comentários relevantes
- preservar estilo do projeto

Modificar apenas o necessário.

---

## Contexto

Nunca trabalhar apenas no arquivo atual.

Sempre analisar:

- dependências
- imports
- exports
- chamadas
- referências
- arquitetura
- módulos relacionados

Toda alteração deve considerar o impacto no projeto inteiro.

---

## Validação

Toda entrada deve ser validada.

Incluindo:

- body
- query
- params
- headers
- cookies
- arquivos
- variáveis de ambiente

Nunca confiar em entrada do usuário.

---

## Tratamento de Erros

Todo erro deve possuir:

- tipo
- mensagem
- código
- contexto
- log estruturado

Nunca lançar Error genérico.

Nunca esconder exceções.

Nunca retornar stack trace para produção.

---

## Segurança

Sempre aplicar:

- autenticação
- autorização
- RBAC quando necessário
- sanitização
- validação
- proteção contra SQL Injection
- proteção contra XSS
- proteção contra CSRF quando aplicável
- Rate Limiting
- CORS seguro

Segurança é obrigatória.

---

## Performance

Sempre considerar:

- índices
- cache
- paginação
- lazy loading
- eager loading
- batch operations
- streaming
- compressão
- paralelismo quando seguro

Evitar:

- N+1 Queries
- loops desnecessários
- processamento duplicado

---

## Banco de Dados

Toda alteração deve preservar:

- integridade
- consistência
- transações
- constraints
- índices
- relacionamentos

Nunca quebrar compatibilidade dos dados existentes.

---

## Testes

Toda implementação deve incluir:

- testes unitários
- testes de integração quando necessário
- testes E2E quando aplicável

Nunca remover testes existentes.

Nunca reduzir cobertura.

---

## Observabilidade

Sempre implementar:

- logs estruturados
- request id
- correlation id
- métricas
- health check
- tracing quando disponível

Todo erro deve ser rastreável.

---

## Documentação

Sempre manter atualizado:

- OpenAPI
- tipos
- contratos
- README quando necessário
- documentação técnica afetada

Nunca deixar documentação inconsistente.

---

## Qualidade

Antes de finalizar qualquer tarefa executar automaticamente:

1. Type Check

2. Build

3. Lint

4. Testes

5. Verificação de arquitetura

6. Verificação de segurança

7. Verificação de performance

8. Atualização de documentação

Se qualquer etapa falhar:

Corrigir automaticamente.

Executar novamente.

Repetir até sucesso.

---

## Comunicação

Código:

- sempre em inglês

Comentários técnicos:

- inglês

Commits:

- inglês

Branches:

- inglês

Variáveis:

- inglês

Classes:

- inglês

Funções:

- inglês

Respostas ao usuário:

- Português (pt-BR)

Nunca misturar idiomas dentro do código.

---

## Critério de Conclusão

Uma tarefa somente pode ser considerada concluída quando:

✔ Código compila

✔ Todos os testes passam

✔ Lint sem erros

✔ TypeScript sem erros

✔ Arquitetura consistente

✔ Sem duplicação

✔ Segurança validada

✔ Performance aceitável

✔ Documentação atualizada

✔ Não existem TODOs

✔ Não existem FIXMEs

✔ Não existem funções vazias

✔ Não existem erros conhecidos

Caso qualquer item acima não seja satisfeito, a tarefa permanece em execução até que todos os critérios sejam atendidos.