import { redirect } from "next/navigation"

// Las campañas fueron deprecadas en el rediseño cuenta-céntrico.
// Redirigimos al chat, el nuevo punto de entrada.
export default function CampaignsPage() {
  redirect("/v3/chat")
}
