import { Button } from "@/components/ui/button"

export default function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <span className="text-sm font-semibold tracking-tight text-foreground">
          Open Polvo
        </span>
        <nav className="flex items-center gap-6">
          <a href="#inicio" className="text-sm text-muted-foreground hover:text-foreground">
            Início
          </a>
          <a href="#servicos" className="text-sm text-muted-foreground hover:text-foreground">
            Serviços
          </a>
          <Button size="sm">Contacto</Button>
        </nav>
      </div>
    </header>
  )
}
