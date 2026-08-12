import { createClient } from "@/lib/supabase/server"

/**
 * Server-side superadmin guard (OPT-01).
 *
 * The admin layout (`app/admin/layout.tsx`) only gates page navigation. Server
 * actions and route handlers are POST endpoints that can be invoked directly,
 * independent of which layout rendered the page, so each privileged action must
 * re-check the role itself. Call this as the first line:
 *
 *   const auth = await requireSuperadmin()
 *   if ("error" in auth) return { error: auth.error }   // or: throw / 403
 *
 * The canonical privileged value is `public.profiles.role = 'superadmin'`.
 * Returns `{ userId }` when authorized, otherwise `{ error }` (never throws),
 * so it is safe to use from both server actions and API route handlers.
 */
export type SuperadminResult = { userId: string } | { error: string }

export async function requireSuperadmin(): Promise<SuperadminResult> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "No autenticado" }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single()

  if (profile?.role !== "superadmin") {
    return { error: "No tenés permisos de super administrador" }
  }

  return { userId: user.id }
}

/** Boolean convenience wrapper around {@link requireSuperadmin}. */
export async function isSuperadmin(): Promise<boolean> {
  const res = await requireSuperadmin()
  return "userId" in res
}

/**
 * Throwing variant for call sites that prefer to abort rather than branch
 * (e.g. inside a try/catch that maps errors to a 403). Returns the userId.
 */
export async function assertSuperadmin(): Promise<string> {
  const res = await requireSuperadmin()
  if ("error" in res) throw new Error(res.error)
  return res.userId
}
