import type { ReactNode } from "react"

import { Separator } from "@/components/ui/separator"
import Navbar from "./Navbar"

type AppShellProps = {
  children: ReactNode
  showSidebar?: boolean
}

const sidebarLinks = [
  { href: "#", label: "Painel" },
  { href: "#", label: "Projectos" },
  { href: "#", label: "Definições" },
]

/** Sidebar inline — evita import "./Sidebar" quando o ficheiro não existe (marketing). */
function SidebarPanel() {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-border bg-muted/30 md:flex md:flex-col">
      <div className="flex h-14 items-center px-4">
        <span className="text-sm font-semibold tracking-tight">Menu</span>
      </div>
      <Separator />
      <nav className="flex flex-col gap-1 p-3">
        {sidebarLinks.map((item) => (
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

export default function AppShell({ children, showSidebar = false }: AppShellProps) {
  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-foreground">
      <Navbar />
      <div className="flex min-h-0 flex-1">
        {showSidebar ? <SidebarPanel /> : null}
        <main className="min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
