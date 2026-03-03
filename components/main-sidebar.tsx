"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Search, Bookmark, User, LogOut, Settings, Loader2, FileText, GraduationCap, Menu, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useOnboarding } from "@/components/onboarding/onboarding-provider"
import { Progress } from "@/components/ui/progress"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { useState, useEffect, useCallback } from "react"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"

const sidebarItems = [
  {
    title: "Busqueda",
    href: "/search",
    icon: Search,
  },
  {
    title: "Mis Bookmarks",
    href: "/bookmarks",
    icon: Bookmark,
  },
  {
    title: "Docs",
    href: "/docs",
    icon: FileText,
  },
  {
    title: "Perfil",
    href: "/profile",
    icon: User,
  },
]

/**
 * Responsive sidebar:
 * - Desktop (lg+): fixed 256px sidebar
 * - Mobile/Tablet (<lg): hamburger button + Sheet drawer
 */
export function MainSidebar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  // Auto-close mobile sheet on navigation
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  return (
    <>
      {/* Mobile header bar with hamburger */}
      <div className="fixed top-0 left-0 right-0 z-40 flex h-14 items-center gap-3 border-b border-sidebar-border bg-sidebar px-4 lg:hidden">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => setMobileOpen(true)}
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2">
          <Image src="/logo.png" alt="ASCI Logo" width={28} height={28} className="rounded-md w-7 h-7" />
          <span className="font-bold text-base">ASCI v2</span>
        </div>
      </div>

      {/* Mobile sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 p-0 bg-sidebar border-sidebar-border">
          <SheetTitle className="sr-only">Menu de navegacion</SheetTitle>
          <SidebarContent />
        </SheetContent>
      </Sheet>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 bg-sidebar border-r border-sidebar-border flex-col h-screen sticky top-0">
        <SidebarContent />
      </aside>
    </>
  )
}

/** Shared sidebar content used in both desktop and mobile */
function SidebarContent() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [isAdmin, setIsAdmin] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const handleSignOut = async () => {
    try {
      setIsLoggingOut(true)
      await supabase.auth.signOut()
      router.push("/auth/login")
    } catch (error) {
      console.error("Error signing out:", error)
    } finally {
      setIsLoggingOut(false)
    }
  }

  const checkAdmin = useCallback(async () => {
    try {
      setIsLoading(true)
      setLoadError(false)
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser()

      if (authError) {
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
          setLoadError(true)
          return
        }

        setIsAdmin(profile?.role === "superadmin" || profile?.role === "admin")
      }
    } catch {
      setLoadError(true)
    } finally {
      setIsLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    checkAdmin()
  }, [checkAdmin])

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-6 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <Image src="/logo.png" alt="ASCI Logo" width={32} height={32} className="rounded-md w-8 h-8" />
          <span className="font-bold text-lg">ASCI v2</span>
        </div>
      </div>

      {/* Nav items */}
      <div className="flex-1 py-6 px-4 flex flex-col gap-2">
        {sidebarItems.map((item) => (
          <Link key={item.href} href={item.href}>
            <Button
              variant={pathname === item.href || pathname.startsWith(item.href + "/") ? "secondary" : "ghost"}
              className={cn(
                "w-full justify-start gap-2",
                (pathname === item.href || pathname.startsWith(item.href + "/")) && "bg-sidebar-accent text-sidebar-accent-foreground",
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
              Error de conexion. Reintentar
            </Button>
          </div>
        ) : isAdmin ? (
          <div className="mt-6">
            <div className="text-xs font-semibold text-muted-foreground mb-2 px-2 uppercase tracking-wider">Admin</div>
            <Link href="/admin/ingest">
              <Button variant="ghost" className="w-full justify-start gap-2">
                <Settings className="h-4 w-4" />
                Administracion
              </Button>
            </Link>
          </div>
        ) : null}
      </div>

      <SidebarOnboardingButton />

      {/* Logout */}
      <div className="p-4 border-t border-sidebar-border">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={handleSignOut}
          disabled={isLoggingOut}
        >
          {isLoggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          {isLoggingOut ? "Cerrando..." : "Cerrar Sesion"}
        </Button>
      </div>
    </div>
  )
}

function SidebarOnboardingButton() {
  const { state, resume, start, isLoading } = useOnboarding()

  if (isLoading || !state) return null
  if (state.status === "completed") return null

  const showResume = state.status === "skipped" || (state.status === "in_progress" && state.progressPercentage > 0)
  const showStart = state.status === "pending"

  if (!showResume && !showStart) return null

  return (
    <div className="px-4 pb-2">
      <button
        onClick={showResume ? resume : start}
        className="w-full rounded-lg border border-primary/20 bg-primary/5 p-3 text-left hover:bg-primary/10 transition-colors"
      >
        <div className="flex items-center gap-2 mb-1.5">
          <GraduationCap className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium text-foreground">
            {showResume ? "Retomar tour" : "Tour de la plataforma"}
          </span>
        </div>
        {state.progressPercentage > 0 && (
          <div className="space-y-1">
            <Progress value={state.progressPercentage} className="h-1.5" />
            <span className="text-[10px] text-muted-foreground">{state.progressPercentage}% completado</span>
          </div>
        )}
        {state.progressPercentage === 0 && (
          <p className="text-[10px] text-muted-foreground">Recorri la plataforma en 3 minutos</p>
        )}
      </button>
    </div>
  )
}
