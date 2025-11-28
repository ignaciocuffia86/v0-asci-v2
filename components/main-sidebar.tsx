"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Search, Bookmark, User, LogOut, Settings, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { useState, useEffect } from "react"

const sidebarItems = [
  {
    title: "Búsqueda",
    href: "/search",
    icon: Search,
  },
  {
    title: "Mis Bookmarks",
    href: "/bookmarks",
    icon: Bookmark,
  },
  {
    title: "Perfil",
    href: "/profile",
    icon: User,
  },
]

export function MainSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [isAdmin, setIsAdmin] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    const checkAdmin = async () => {
      try {
        setIsLoading(true)
        setLoadError(false)
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser()

        if (authError) {
          console.log("[v0] Auth error:", authError.message)
          setLoadError(true)
          return
        }

        if (user) {
          const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("role")
            .eq("id", user.id)
            .single()

          if (profileError) {
            console.log("[v0] Profile error:", profileError.message)
            setLoadError(true)
            return
          }

          setIsAdmin(profile?.role === "superadmin" || profile?.role === "admin")
        }
      } catch (err) {
        console.log("[v0] Sidebar error:", err)
        setLoadError(true)
      } finally {
        setIsLoading(false)
      }
    }
    checkAdmin()
  }, [])

  return (
    <aside className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col h-screen sticky top-0">
      <div className="p-6 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <Image src="/logo.png" alt="ASCI Logo" width={32} height={32} className="rounded-md" />
          <span className="font-bold text-lg">ASCI v2</span>
        </div>
      </div>

      <div className="flex-1 py-6 px-4 flex flex-col gap-2">
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

        {isLoading ? (
          <div className="mt-6 flex items-center justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : loadError ? (
          <div className="mt-6 px-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs text-muted-foreground"
              onClick={() => window.location.reload()}
            >
              Error de conexión. Reintentar
            </Button>
          </div>
        ) : isAdmin ? (
          <div className="mt-6">
            <div className="text-xs font-semibold text-muted-foreground mb-2 px-2 uppercase tracking-wider">Admin</div>
            <Link href="/admin/ingest">
              <Button variant="ghost" className="w-full justify-start gap-2">
                <Settings className="h-4 w-4" />
                Administración
              </Button>
            </Link>
          </div>
        ) : null}
      </div>

      <div className="p-4 border-t border-sidebar-border">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={() => router.push("/auth/login")}
        >
          <LogOut className="h-4 w-4" />
          Cerrar Sesión
        </Button>
      </div>
    </aside>
  )
}
