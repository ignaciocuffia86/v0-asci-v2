import { createClient } from "@supabase/supabase-js"

// Cliente admin con service role key para operaciones privilegiadas
// Solo usar en el servidor, nunca exponer al cliente
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
