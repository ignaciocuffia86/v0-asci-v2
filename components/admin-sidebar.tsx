"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  Upload,
  BookOpen,
  Activity,
  FileText,
  LogOut,
  Search,
  Building2,
  MessageSquare,
  Users,
  Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"

const sidebarItems = [
  {
    title: "Ingesta de Datos",
    href: "/admin/ingest",
    icon: Upload,
  },
  {
    title: "Diccionario",
    href: "/admin/dictionary",
    icon: BookOpen,
  },
  {
    title: "Compañías",
    href: "/admin/companies/duplicates",
    icon: Building2,
  },
  {
    title: "Templates de Mensajes",
    href: "/admin/templates",
    icon: MessageSquare,
  },
  {
    title: "Prompts AI",
    href: "/admin/prompts",
    icon: Sparkles,
  },
  {
    title: "Procesamiento",
    href: "/admin/processing",
    icon: Activity,
  },
  {
    title: "Logs",
    href: "/admin/logs",
    icon: FileText,
  },
  {
    title: "Uso por Usuario",
    href: "/admin/usage",
    icon: Users,
  },
]

export function AdminSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push("/auth/login")
  }

  return (
    <aside className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col h-screen sticky top-0">
      <div className="p-6 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 bg-primary rounded-md flex items-center justify-center text-primary-foreground font-bold">
            A
          </div>
          <span className="font-bold text-lg">ASCI Admin</span>
        </div>
      </div>

      <div className="flex-1 py-6 px-4 flex flex-col gap-2">
        <div className="mb-4">
          <Link href="/search">
            <Button variant="outline" className="w-full justify-start gap-2 bg-transparent">
              <Search className="h-4 w-4" />
              Volver a Búsqueda
            </Button>
          </Link>
        </div>

        <div className="text-xs font-semibold text-muted-foreground mb-2 px-2 uppercase tracking-wider">Gestión</div>

        {sidebarItems.map((item) => (
          <Link key={item.href} href={item.href}>
            <Button
              variant={pathname === item.href ? "secondary" : "ghost"}
              className={cn(
                "w-full justify-start gap-2",
                pathname === item.href && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.title}
            </Button>
          </Link>
        ))}
      </div>

      <div className="p-4 border-t border-sidebar-border">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4" />
          Cerrar Sesión
        </Button>
      </div>
    </aside>
  )
}
