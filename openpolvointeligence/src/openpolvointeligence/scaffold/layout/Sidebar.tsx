import { Separator } from "@/components/ui/separator"

const links = [
  { href: "#", label: "Painel" },
  { href: "#", label: "Projectos" },
  { href: "#", label: "Definições" },
]

export default function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-border bg-muted/30 md:flex md:flex-col">
      <div className="flex h-14 items-center px-4">
        <span className="text-sm font-semibold tracking-tight">Menu</span>
      </div>
      <Separator />
      <nav className="flex flex-col gap-1 p-3">
        {links.map((item) => (
          <a
            key={item.label}
            href={item.href}
            className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {item.label}
          </a>
        ))}
      </nav>
    </aside>
  )
}
