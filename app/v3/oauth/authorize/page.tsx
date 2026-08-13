import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { OAuthConsentForm } from "./oauth-consent-form"

export default async function OAuthAuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => { if (typeof value === "string") query.set(key, value) })
  if (!user) redirect(`/auth/login?next=${encodeURIComponent(`/v3/oauth/authorize?${query}`)}`)

  return <OAuthConsentForm clientId={String(params.client_id || "")} redirectUri={String(params.redirect_uri || "")} state={typeof params.state === "string" ? params.state : undefined} codeChallenge={String(params.code_challenge || "")} requestedScope={String(params.scope || "")} resource={String(params.resource || "")} />
}
