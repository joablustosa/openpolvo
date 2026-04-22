# Kit arquitectónico: `landing_page`

Landing pages profissionais, rápidas, animadas. Mesma base do `frontend_only` **mas** com secções bem definidas e animação leve. Sem backend.

## File tree obrigatório

```
(root)/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── index.html
├── README.md
└── src/
    ├── main.tsx
    ├── App.tsx                       # compõe as secções
    ├── index.css                     # tokens OKLCH + Tailwind
    ├── lib/utils.ts                  # cn()
    ├── components/ui/                # Button, Card, Input, Badge
    └── sections/
        ├── Nav.tsx                   # logo + CTA sticky
        ├── Hero.tsx                  # headline + sub + CTA primário
        ├── Features.tsx              # 3-6 cards
        ├── Pricing.tsx               # opcional (2-3 tiers)
        ├── Testimonials.tsx          # opcional
        ├── FAQ.tsx                   # opcional (accordion)
        ├── CTA.tsx                   # banner de fecho
        └── Footer.tsx
```

## `package.json`

```json
{
  "name": "landing",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.4",
    "framer-motion": "^11.11.17",
    "lucide-react": "^0.460.0"
  },
  "devDependencies": {
    "@fontsource-variable/geist": "^5.1.0",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.3",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.3",
    "vite": "^5.4.10"
  }
}
```

## Padrão de secção

- Cada secção em `src/sections/{Name}.tsx` exportada como `{Name}Section`.
- Max width `max-w-6xl mx-auto px-6 py-20`.
- Título: `text-4xl md:text-5xl font-bold tracking-tight`; subtítulo: `text-lg text-muted-foreground`.
- CTA primário usa variante `default`; secundário `outline`.
- Animação: `framer-motion` com `initial={{opacity:0, y:20}} whileInView={{opacity:1, y:0}} viewport={{once:true}}` — **nunca** animações invasivas.

## Regras

- Headline clara em **uma linha**; subtítulo explica benefício em **uma frase**.
- Hero tem sempre uma imagem/screenshot mock (usa `<div class="aspect-video rounded-xl border bg-gradient-to-br from-primary/10 to-accent">` se não houver asset).
- Nav é sticky com `backdrop-blur` e border-bottom subtil.
- Footer minimalista com copyright + 3-4 links.
- Testimonials: 3 cards com `Avatar` (iniciais), `name`, `role`, `quote`.
- Pricing: 3 tiers max; destacar o do meio com `border-primary shadow-lg`.
- FAQ: accordion inline (sem dependências) usando `<details>/<summary>` com `group` Tailwind.
- **Performance**: nenhuma imagem > 200KB; usar `loading="lazy"` em imagens abaixo da dobra.
