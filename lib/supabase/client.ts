import { createBrowserClient } from "@supabase/ssr"

let client: ReturnType<typeof createBrowserClient> | undefined

export function createClient() {
  if (client) return client

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  
  if (!url || !key) {
    console.error("[v0] Supabase client: Missing env vars", { 
      hasUrl: !!url, 
      hasKey: !!key,
      url: url?.substring(0, 30) + "..."
    })
    throw new Error("Missing Supabase environment variables. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in v0 Settings > Vars")
  }

  client = createBrowserClient(url, key)

  return client
}
