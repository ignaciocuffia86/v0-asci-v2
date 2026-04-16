"use client"

import Link from "next/link"
import Image from "next/image"
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
  UserCog,
  Sparkles,
  Download,
  ChevronDown,
  ChevronRight,
  Factory,
} from "lucide-react"
import { useState } from "react"
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
    title: "Industrias",
    href: "/admin/industries",
    icon: Factory,
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
    title: "Documentos",
    href: "/admin/documents",
    icon: FileText,
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
  {
    title: "Gestion de Usuarios",
    href: "/admin/users",
    icon: UserCog,
  },
  {
    title: "Exportaciones",
    href: "/admin/export",
    icon: Download,
  },
]

export function AdminSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [companiesOpen, setCompaniesOpen] = useState(pathname.startsWith("/admin/companies"))
  const [exportOpen, setExportOpen] = useState(pathname.startsWith("/admin/export"))

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push("/auth/login")
  }

  const isCompaniesPage = pathname.startsWith("/admin/companies")
  const isExportPage = pathname.startsWith("/admin/export")

  return (
    <aside className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col h-screen sticky top-0">
      <div className="p-6 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <Image src="/logo.png" alt="ASCI Logo" width={32} height={32} className="rounded-md w-8 h-8" />
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

        {sidebarItems.map((item) => {
          // Special handling for Companies submenu
          if (item.title === "Compañías") {
            return (
              <div key="companies">
                <Button
                  variant={isCompaniesPage ? "secondary" : "ghost"}
                  className={cn(
                    "w-full justify-start gap-2",
                    isCompaniesPage && "bg-sidebar-accent text-sidebar-accent-foreground"
                  )}
                  onClick={() => setCompaniesOpen(!companiesOpen)}
                >
                  <item.icon className="h-4 w-4" />
                  {item.title}
                  {companiesOpen ? (
                    <ChevronDown className="h-4 w-4 ml-auto" />
                  ) : (
                    <ChevronRight className="h-4 w-4 ml-auto" />
                  )}
                </Button>
                {companiesOpen && (
                  <div className="ml-6 mt-1 space-y-1">
                    <Link href="/admin/companies">
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "w-full justify-start text-sm",
                          pathname === "/admin/companies" && "bg-sidebar-accent/50"
                        )}
                      >
                        Gestión de Compañías
                      </Button>
                    </Link>
                    <Link href="/admin/companies/duplicates">
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "w-full justify-start text-sm",
                          pathname === "/admin/companies/duplicates" && "bg-sidebar-accent/50"
                        )}
                      >
                        Ver Duplicados
                      </Button>
                    </Link>
                  </div>
                )}
              </div>
            )
          }

          // Special handling for Exportaciones submenu
          if (item.title === "Exportaciones") {
            return (
              <div key="export">
                <Button
                  variant={isExportPage ? "secondary" : "ghost"}
                  className={cn(
                    "w-full justify-start gap-2",
                    isExportPage && "bg-sidebar-accent text-sidebar-accent-foreground"
                  )}
                  onClick={() => setExportOpen(!exportOpen)}
                >
                  <item.icon className="h-4 w-4" />
                  {item.title}
                  {exportOpen ? (
                    <ChevronDown className="h-4 w-4 ml-auto" />
                  ) : (
                    <ChevronRight className="h-4 w-4 ml-auto" />
                  )}
                </Button>
                {exportOpen && (
                  <div className="ml-6 mt-1 space-y-1">
                    <Link href="/admin/export/companies-signals">
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "w-full justify-start text-sm",
                          pathname === "/admin/export/companies-signals" && "bg-sidebar-accent/50"
                        )}
                      >
                        Export Compañías
                      </Button>
                    </Link>
                    <Link href="/admin/export/contacts">
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "w-full justify-start text-sm",
                          pathname === "/admin/export/contacts" && "bg-sidebar-accent/50"
                        )}
                      >
                        Export Contactos
                      </Button>
                    </Link>
                  </div>
                )}
              </div>
            )
          }

          return (
            <Link key={item.href} href={item.href}>
              <Button
                variant={pathname === item.href ? "secondary" : "ghost"}
                className={cn(
                  "w-full justify-start gap-2",
                  pathname === item.href && "bg-sidebar-accent text-sidebar-accent-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.title}
              </Button>
            </Link>
          )
        })}
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
