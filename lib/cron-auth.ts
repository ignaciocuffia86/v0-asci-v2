import { NextResponse } from "next/server"

/**
 * Shared authorization guard for Vercel cron routes.
 *
 * Replaces the per-route inlined checks (which had diverged into several
 * variants, and in two routes only logged the unauthorized attempt without
 * returning — OPT-02). Call it as the first line of each cron handler:
 *
 *   const denied = assertCron(request)
 *   if (denied) return denied
 *
 * Behavior:
 *   - In production, requires `Authorization: Bearer <CRON_SECRET>` exactly.
 *   - Outside production (local/dev), allows the call through so crons can be
 *     exercised without the secret — matching the previous dominant behavior.
 *
 * Returns a 401 NextResponse when the request must be rejected, or null when
 * it is authorized (or dev-allowed).
 */
export function assertCron(request: Request): NextResponse | null {
  const authHeader = request.headers.get("authorization")
  const secret = process.env.CRON_SECRET
  const authorized = !!secret && authHeader === `Bearer ${secret}`

  if (!authorized && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return null
}
