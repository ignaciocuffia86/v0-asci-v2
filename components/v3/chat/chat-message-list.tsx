"use client"

import { useEffect, useRef } from "react"
import { Sparkles, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { V3ChatMessage } from "@/app/api/v3/chat/route"
import {
  ResolutionCard,
  PreviewAccountsCard,
  BatchProgressCard,
  AccountOverviewCard,
  FollowResultCard,
  FollowedListCard,
  ContactsCard,
  IcebreakerCard,
} from "./tool-cards"

type SendMessageFn = (message: { text: string }) => void

function ToolPart({
  part,
  sendMessage,
  isBusy,
}: {
  part: Extract<V3ChatMessage["parts"][number], { type: `tool-${string}` }>
  sendMessage: SendMessageFn
  isBusy: boolean
}) {
  // Estados de input: mostrar loader genérico
  if (part.state === "input-streaming" || part.state === "input-available") {
    const labels: Record<string, string> = {
      "tool-resolveCompanies": "Resolviendo empresas...",
      "tool-previewAccounts": "Analizando señales en cache...",
      "tool-startResearch": "Encolando research...",
      "tool-checkBatchStatus": "Consultando progreso...",
      "tool-getAccountOverview": "Cargando cuenta...",
      "tool-followAccounts": "Siguiendo cuentas...",
      "tool-unfollowAccount": "Dejando de seguir...",
      "tool-listFollowed": "Cargando cuentas seguidas...",
      "tool-suggestContacts": "Buscando contactos...",
      "tool-generateIcebreakers": "Generando icebreaker...",
    }
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        {labels[part.type] ?? "Procesando..."}
      </div>
    )
  }

  if (part.state === "output-error") {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        Error: {part.errorText}
      </div>
    )
  }

  if (part.state !== "output-available") return null

  switch (part.type) {
    case "tool-resolveCompanies":
      return <ResolutionCard output={part.output} sendMessage={sendMessage} isBusy={isBusy} />
    case "tool-previewAccounts":
      return <PreviewAccountsCard output={part.output} sendMessage={sendMessage} isBusy={isBusy} />
    case "tool-startResearch":
      return <BatchProgressCard output={part.output} sendMessage={sendMessage} isBusy={isBusy} />
    case "tool-checkBatchStatus":
      return <BatchProgressCard output={part.output} sendMessage={sendMessage} isBusy={isBusy} static />
    case "tool-getAccountOverview":
      return <AccountOverviewCard output={part.output} sendMessage={sendMessage} isBusy={isBusy} />
    case "tool-followAccounts":
      return <FollowResultCard output={part.output} />
    case "tool-listFollowed":
      return <FollowedListCard output={part.output} sendMessage={sendMessage} isBusy={isBusy} />
    case "tool-suggestContacts":
      return <ContactsCard output={part.output} sendMessage={sendMessage} isBusy={isBusy} />
    case "tool-generateIcebreakers":
      return <IcebreakerCard output={part.output} sendMessage={sendMessage} isBusy={isBusy} />
    case "tool-unfollowAccount":
      return (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Cuenta dejada de seguir.
        </div>
      )
    default:
      return null
  }
}

export function ChatMessageList({
  messages,
  isBusy,
  sendMessage,
}: {
  messages: V3ChatMessage[]
  isBusy: boolean
  sendMessage: SendMessageFn
}) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 pb-8">
        {messages.map((message) => (
          <div key={message.id} className={cn("flex gap-3", message.role === "user" && "justify-end")}>
            {message.role === "assistant" && (
              <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
                <Sparkles className="size-3.5 text-primary" />
              </div>
            )}
            <div
              className={cn(
                "flex min-w-0 flex-col gap-3",
                message.role === "user"
                  ? "max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-primary-foreground"
                  : "max-w-full flex-1"
              )}
            >
              {message.parts.map((part, i) => {
                if (part.type === "text") {
                  return (
                    <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed">
                      {part.text}
                    </p>
                  )
                }
                if (part.type.startsWith("tool-")) {
                  return (
                    <ToolPart
                      key={i}
                      part={part as Extract<V3ChatMessage["parts"][number], { type: `tool-${string}` }>}
                      sendMessage={sendMessage}
                      isBusy={isBusy}
                    />
                  )
                }
                return null
              })}
            </div>
          </div>
        ))}
        {isBusy && messages[messages.length - 1]?.role === "user" && (
          <div className="flex gap-3">
            <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
              <Sparkles className="size-3.5 text-primary" />
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Pensando...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
