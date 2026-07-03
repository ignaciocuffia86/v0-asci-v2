"use client"

import { useRef, useState } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { ArrowUp, Square, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { createConversation, renameConversation } from "@/app/actions/v3/chat"
import { ChatMessageList } from "./chat-message-list"
import type { V3ChatMessage } from "@/app/api/v3/chat/route"

const SUGGESTIONS = [
  "Investigá Arcor y Globant",
  "¿Qué cuentas estamos siguiendo?",
  "Mostrame los contactos de una cuenta investigada",
]

export function ChatPanel({
  conversationId: initialConversationId,
  initialMessages,
  onConversationCreated,
}: {
  conversationId: string | null
  initialMessages: V3ChatMessage[]
  onConversationCreated: (id: string, firstUserText: string) => void
}) {
  const [input, setInput] = useState("")
  const conversationIdRef = useRef<string | null>(initialConversationId)

  const { messages, sendMessage, status, stop } = useChat<V3ChatMessage>({
    transport: new DefaultChatTransport({
      api: "/api/v3/chat",
      prepareSendMessagesRequest: ({ messages: msgs }) => ({
        body: {
          messages: msgs,
          conversationId: conversationIdRef.current,
        },
      }),
    }),
    messages: initialMessages,
  })

  const isBusy = status === "streaming" || status === "submitted"

  const handleSubmit = async () => {
    const text = input.trim()
    if (!text || isBusy) return

    // Crear conversación en el primer mensaje si no existe
    if (!conversationIdRef.current) {
      const result = await createConversation(text.slice(0, 60))
      if ("id" in result) {
        conversationIdRef.current = result.id
        onConversationCreated(result.id, text)
        void renameConversation(result.id, text.slice(0, 60))
      }
    }

    setInput("")
    void sendMessage({ text })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10">
            <Sparkles className="size-6 text-primary" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold text-balance">¿Qué cuentas investigamos hoy?</h1>
            <p className="mt-1 max-w-md text-sm text-muted-foreground text-pretty">
              Escribí nombres o dominios de empresas y armo la radiografía completa: señales, scorecard, contactos e
              icebreakers.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setInput(s)}
                className="rounded-full border border-border bg-background px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ChatMessageList messages={messages} isBusy={isBusy} sendMessage={sendMessage} />
      )}

      {/* Input */}
      <div className="border-t border-border bg-background p-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribí empresas para investigar o preguntá algo..."
            rows={1}
            className="max-h-40 min-h-[44px] flex-1 resize-none"
            disabled={isBusy}
          />
          {isBusy ? (
            <Button size="icon" variant="outline" onClick={() => stop()} aria-label="Detener">
              <Square className="size-4" />
            </Button>
          ) : (
            <Button size="icon" onClick={() => void handleSubmit()} disabled={!input.trim()} aria-label="Enviar">
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-muted-foreground">
          Máximo 25 cuentas por lote. Los datos salen del research, nunca se inventan.
        </p>
      </div>
    </div>
  )
}
