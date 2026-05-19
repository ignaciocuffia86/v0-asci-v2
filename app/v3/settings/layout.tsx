"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Key, Users, Building2, ChevronLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const settingsNav = [
  { href: "/v3/settings", label: "General", icon: Building2 },
  { href: "/v3/settings/api-keys", label: "API Keys", icon: Key },
  { href: "/v3/settings/workspace", label: "Workspace", icon: Users },
]

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  
  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 items-center gap-4 px-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/v3/campaigns">
              <ChevronLeft className="mr-1 size-4" />
              Volver
            </Link>
          </Button>
          <div className="h-4 w-px bg-border" />
          <h1 className="text-lg font-semibold">Configuración</h1>
        </div>
      </header>
      
      <div className="flex flex-1">
        {/* Sidebar */}
        <aside className="w-56 border-r border-border bg-card/50 p-4">
          <nav className="flex flex-col gap-1">
            {settingsNav.map((item) => {
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    isActive 
                      ? "bg-accent text-accent-foreground" 
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </aside>
        
        {/* Content */}
        <main className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
