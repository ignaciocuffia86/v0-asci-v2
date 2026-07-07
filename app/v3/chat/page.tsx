import { redirect } from "next/navigation"
import { getOnboardingStatus } from "@/app/actions/v3/workspace"
import { listConversations } from "@/app/actions/v3/chat"
import { ChatShell } from "@/components/v3/chat/chat-shell"

export const metadata = {
  title: "Chat | ASCI v3",
}

export default async function V3ChatPage() {
  const status = await getOnboardingStatus()

  if (status.status === "no_workspace") redirect("/v3/onboarding")
  if (status.status === "active_member" && !status.hasDocuments) redirect("/v3/docs")
  if (status.status !== "active_member") redirect("/v3/onboarding")

  const conversations = await listConversations()

  return <ChatShell initialConversations={conversations} />
}
