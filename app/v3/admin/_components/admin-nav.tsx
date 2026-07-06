"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { BarChart3, Bot, Building2, FileTerminal, Users } from "lucide-react"

const SECTIONS = [
  { href: "/v3/admin/usage", label: "Uso y costos", icon: BarChart3 },
  { href: "/v3/admin/workspaces", label: "Workspaces", icon: Building2 },
  { href: "/v3/admin/users", label: "Usuarios", icon: Users },
  { href: "/v3/admin/prompts", label: "Prompts", icon: FileTerminal },
  { href: "/v3/admin/agents", label: "Micro-agentes", icon: Bot },
]

export function AdminNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="Secciones de administración" className="border-b border-border">
      <ul className="flex gap-1">
        {SECTIONS.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href)
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
