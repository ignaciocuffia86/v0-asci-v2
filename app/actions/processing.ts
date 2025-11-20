"use server"

import { createClient } from "@/lib/supabase/server"

export async function processSignals(batchSize = 50) {
  const supabase = await createClient()

  // 1. Get pending contacts
  const { data: contacts, error } = await supabase.from("contacts").select("id").eq("processed", false).limit(batchSize)

  if (error) {
    console.error("Error fetching pending contacts:", error)
    return { success: false, error: error.message }
  }

  if (!contacts || contacts.length === 0) {
    return { success: true, processed: 0, message: "No pending contacts found." }
  }

  let processedCount = 0
  let errors = 0

  // 2. Process each contact using the database function
  // We call the RPC function for each contact.
  // Ideally, we could make a batch RPC function, but this is safer for timeouts.
  for (const contact of contacts) {
    try {
      const { error: rpcError } = await supabase.rpc("process_contact_signals", {
        contact_id: contact.id,
      })

      if (rpcError) {
        console.error(`Error processing contact ${contact.id}:`, rpcError)
        errors++
      } else {
        processedCount++
      }
    } catch (e) {
      console.error(`Exception processing contact ${contact.id}:`, e)
      errors++
    }
  }

  return {
    success: true,
    processed: processedCount,
    errors,
    remaining: contacts.length - processedCount - errors, // Should be 0 if batch finished
  }
}

export async function getProcessingStats() {
  const supabase = await createClient()

  const { count: pendingCount } = await supabase
    .from("contacts")
    .select("*", { count: "exact", head: true })
    .eq("processed", false)

  const { count: totalSignals } = await supabase.from("signals").select("*", { count: "exact", head: true })

  return {
    pending: pendingCount || 0,
    signals: totalSignals || 0,
  }
}
