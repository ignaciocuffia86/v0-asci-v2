import { MainSidebar } from "@/components/main-sidebar"
import { WhatsNewModal } from "@/components/whats-new-modal"

/**
 * Shared layout shell for all authenticated app pages.
 * Provides the responsive sidebar + main content area.
 * On mobile (<lg): top bar with hamburger + sheet drawer, content fills full width with top padding.
 * On desktop (lg+): fixed sidebar 256px + scrollable content area.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <MainSidebar />
      {/* pt-14 on mobile for the fixed top bar, lg:pt-0 when sidebar is visible */}
      <main className="flex-1 min-w-0 overflow-y-auto pt-14 lg:pt-0">{children}</main>
      {/* Novedades — solo aparece en rutas autenticadas, post-login */}
      <WhatsNewModal />
    </div>
  )
}
