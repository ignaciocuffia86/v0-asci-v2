import type React from "react"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { MainSidebar } from "@/components/main-sidebar"

export default async function SearchLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    console.log("[v0] Search Layout: No user found, redirecting to /auth/login")
    redirect("/auth/login")
  }

  return (
    <div className="flex min-h-screen bg-background">
      <MainSidebar />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
