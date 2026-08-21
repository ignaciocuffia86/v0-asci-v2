import "server-only"

import { cache } from "react"
import { createClient } from "@/lib/supabase/server"

/**
 * Identidad del request, resuelta UNA sola vez.
 *
 * ── Por qué existe (medido) ──
 * `supabase.auth.getUser()` no lee una cookie: hace un round-trip a la API de
 * Auth de Supabase para validar el JWT. La base está en `sa-east-1` (São Paulo),
 * así que cada llamada cuesta la latencia física del salto.
 *
 * Al abrir una cuenta de v3 eso pasaba CUATRO veces por carga: una en
 * `getOnboardingStatus()` y una más en cada uno de los tres server actions que
 * la página resuelve en paralelo (`getAccountDetail`, `getAccountSignals`,
 * `getAccountReportData`), porque cada uno tenía su propio `getAuthContext()`.
 * Sumado a la resolución del workspace, eran 8 idas y vueltas para contestar
 * "¿quién sos?", y el primer par bloquea antes del `Promise.all`.
 *
 * `cache()` de React memoiza por request: la primera llamada paga el viaje y
 * las demás resuelven en memoria. No es un cache entre requests — no hay riesgo
 * de servirle a alguien la identidad de otro.
 */
export const getRequestUser = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) return null
  return user
})

/** Igual que `getRequestUser` pero lanza, para los caminos que exigen sesión. */
export async function requireRequestUser() {
  const user = await getRequestUser()
  if (!user) throw new Error("No autenticado")
  return user
}
