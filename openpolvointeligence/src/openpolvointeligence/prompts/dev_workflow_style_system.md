# Style System — design profissional (OpenPolvo Dev Studio)

Guia visual **obrigatório** para todo o JSX/CSS gerado. O resultado deve parecer um produto profissional (nível ferramenta), não um template genérico de IA. Combina com o `design_tokens` e o `style_guide` (Style RAG) que recebes no contexto.

## Tokens semânticos (nunca cores cruas)

- Fundo: `bg-background` / texto `text-foreground`; secundário `text-muted-foreground`.
- Superfícies: cartão `bg-card text-card-foreground`; zona `bg-muted/30`.
- Ação primária `bg-primary text-primary-foreground`; secundária `bg-secondary`.
- Bordas `border-border`; foco `focus-visible:ring-3 focus-visible:ring-ring/50`.
- **Proibido:** `bg-white`, `text-gray-600`, hex, `bg-gradient-*`, `from-pink-*`, `text-blue-600` solto.

## Raio, tipografia e densidade

- Fonte **Geist** (`--font-sans`). Cartões/painéis `rounded-xl`; botões/inputs `rounded-lg`; pílulas/badges `rounded-4xl`.
- Corpo `text-sm`; secundário `text-xs text-muted-foreground`; título de secção `text-sm font-semibold tracking-tight`; heros `text-3xl`–`text-5xl font-semibold tracking-tight`.
- Densidade alta em apps/dashboards: `gap-2`/`gap-1.5`, `px-3`/`px-4`, cabeçalhos `h-11`, inputs/botões `h-8`. Em marketing, secções `py-16`–`py-24`.

## Componentes shadcn (reutiliza, não recries)

`Button`, `Card`, `Badge`, `Input`, `Label`, `Textarea`, `Select`, `Tabs`, `Dialog`, `DropdownMenu`, `Tooltip`, `Avatar`, `Separator`, `ScrollArea`, `Table`, `Chart`. Importa de `@/components/ui/*`. **Proibido** `<button>`/`<input>` HTML cru ou divs a imitar Card.

## Layout e acessibilidade

- Zonas roláveis: container `flex min-h-0` e área rolável `flex-1 min-h-0` dentro de `<ScrollArea>` (sem `min-h-0` o scroll quebra).
- `aria-label` em botões só-ícone e na `<section>` raiz; texto que estoura usa `truncate` + `min-w-0` no pai flex.
- Ícones `lucide-react` com tamanho fixo (`size-4`/`size-5`). Uma só acção primária por tela.

## Aplicação do `style_guide`

Respeita `domain`, `tone`, `layout_shell`, `palette` e `design_tokens` recebidos. O `accent` só aparece em CTAs, `Badge` e item activo de navegação — nunca em fundos de secção. Funciona em claro e escuro automaticamente (tokens). UI em **português**.
