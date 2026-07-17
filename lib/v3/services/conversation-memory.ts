import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"

const RECENT_MESSAGE_LIMIT = 12
const SUMMARY_CHAR_LIMIT = 6_000

function textFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return ""
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") return ""
      const value = part as Record<string, unknown>
      if (value.type === "text" && typeof value.text === "string") return value.text
      if (String(value.type ?? "").startsWith("tool-") && value.output) {
        try {
          return `[resultado ${String(value.type).replace("tool-", "")}]: ${JSON.stringify(value.output).slice(0, 800)}`
        } catch {
          return ""
        }
      }
      return ""
    })
    .filter(Boolean)
    .join(" ")
}

export async function getConversationMemory(conversationId: string, workspaceId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .schema("v3")
    .from("conversation_memory")
    .select("summary, active_entities, preferences, result_references, version")
    .eq("conversation_id", conversationId)
    .eq("workspace_id", workspaceId)
    .maybeSingle()
  return data
}

export function compactMessagesForModel<T>(messages: T[]) {
  return messages.length > RECENT_MESSAGE_LIMIT ? messages.slice(-RECENT_MESSAGE_LIMIT) : messages
}

export async function updateConversationMemory(input: {
  conversationId: string
  workspaceId: string
  messages: Array<{ role: string; parts?: unknown }>
}) {
  if (input.messages.length <= RECENT_MESSAGE_LIMIT) return

  const older = input.messages.slice(0, -RECENT_MESSAGE_LIMIT)
  const lines = older
    .map((message) => `${message.role}: ${textFromParts(message.parts)}`)
    .filter((line) => line.length > line.indexOf(":") + 2)

  if (lines.length === 0) return

  const admin = createAdminClient()
  const { data: existing } = await admin
    .schema("v3")
    .from("conversation_memory")
    .select("summary, version")
    .eq("conversation_id", input.conversationId)
    .maybeSingle()

  const summary = [existing?.summary, ...lines]
    .filter(Boolean)
    .join("\n")
    .slice(-SUMMARY_CHAR_LIMIT)

  await admin.schema("v3").from("conversation_memory").upsert(
    {
      conversation_id: input.conversationId,
      workspace_id: input.workspaceId,
      summary,
      version: (existing?.version ?? 0) + 1,
      compacted_through: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "conversation_id" }
  )
}
