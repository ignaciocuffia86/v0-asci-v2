import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

// Apollo sends phone data asynchronously to this webhook
// after we call people/match with reveal_phone_number: true + webhook_url
export async function POST(request: Request) {
  try {
    const data = await request.json()

    // Apollo sends the enriched person data with phone numbers
    const person = data.person || data
    if (!person?.id) {
      return NextResponse.json({ error: "No person data" }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    // Extract phone numbers
    const mobileEntry = person.phone_numbers?.find((p: { type: string }) => p.type === "mobile")
    const workEntry = person.phone_numbers?.find((p: { type: string }) => p.type === "work")
    const anyEntry = person.phone_numbers?.[0]
    const mobilePhone =
      mobileEntry?.raw_number || mobileEntry?.sanitized_number || person.sanitized_phone || null
    const workPhone =
      workEntry?.raw_number ||
      workEntry?.sanitized_number ||
      anyEntry?.raw_number ||
      anyEntry?.sanitized_number ||
      null

    if (!mobilePhone && !workPhone) {
      return NextResponse.json({ ok: true, message: "No phone data to update" })
    }

    // Update user_company_contacts by linkedin_url (most reliable identifier)
    if (person.linkedin_url) {
      await supabase
        .from("user_company_contacts")
        .update({
          mobile_phone: mobilePhone,
          phone: workPhone || mobilePhone,
        })
        .eq("linkedin_url", person.linkedin_url)
        .is("mobile_phone", null)

      // Also update the cache
      await supabase
        .from("apollo_contacts_cache")
        .update({
          mobile_phone: mobilePhone,
          phone: workPhone || mobilePhone,
        })
        .eq("linkedin_url", person.linkedin_url)
        .is("mobile_phone", null)
    }

    return NextResponse.json({ ok: true, message: "Phone data updated" })
  } catch (error) {
    console.error("Apollo webhook error:", error)
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}
