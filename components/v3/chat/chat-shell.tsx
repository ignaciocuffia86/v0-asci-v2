"use client"

import { useState, useCallback } from "react"
import { Plus, MessageSquare, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import {
  createConversation,
  deleteConversation,
  getConversationMessages,
  type ConversationSummary,
} from "@/app/actions/v3/chat"
import { ChatPanel } from "./chat-panel"
import type { V3ChatMessage } from "@/app/api/v3/chat/route"

export function ChatShell({ initialConversations }: { initialConversations: ConversationSummary[] }) {
  const [conversations, setConversations] = useState(initialConversations)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [initialMessages, setInitialMessages] = useState<V3ChatMessage[]>([])
  const [loadingConversation, setLoadingConversation] = useState(false)
  // Key para forzar remount del panel al cambiar de conversación
  const [panelKey, setPanelKey] = useState(0)

  const handleNew = useCallback(async () => {
    const result = await createConversation()
    if ("id" in result) {
      const newConv: ConversationSummary = {
        id: result.id,
        title: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      setConversations((prev) => [newConv, ...prev])
      setActiveId(result.id)
      setInitialMessages([])
      setPanelKey((k) => k + 1)
    }
  }, [])

  const handleSelect = useCallback(
    async (id: string) => {
      if (id === activeId) return
      setLoadingConversation(true)
      try {
        const messages = await getConversationMessages(id)
        setInitialMessages(
          messages.map((m) => ({
            id: m.id,
            role: m.role as V3ChatMessage["role"],
            parts: m.parts as V3ChatMessage["parts"],
          }))
        )
        setActiveId(id)
        setPanelKey((k) => k + 1)
      } finally {
        setLoadingConversation(false)
      }
    },
    [activeId]
  )

  const handleDelete = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation()
      await deleteConversation(id)
      setConversations((prev) => prev.filter((c) => c.id !== id))
      if (activeId === id) {
        setActiveId(null)
        setInitialMessages([])
        setPanelKey((k) => k + 1)
      }
    },
    [activeId]
  )

  // Cuando el primer mensaje se envía sin conversación activa, se crea una
  const handleConversationCreated = useCallback((id: string, firstUserText: string) => {
    const newConv: ConversationSummary = {
      id,
      title: firstUserText.slice(0, 60),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    setConversations((prev) => [newConv, ...prev])
    setActiveId(id)
  }, [])

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Sidebar de conversaciones */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-muted/30 md:flex">
        <div className="p-3">
          <Button onClick={handleNew} variant="outline" className="w-full justify-start gap-2 bg-transparent">
            <Plus className="size-4" />
            Nueva conversación
          </Button>
        </div>
        <ScrollArea className="flex-1 px-3 pb-3">
          <div className="flex flex-col gap-1">
            {conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => handleSelect(c.id)}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent",
                  activeId === c.id && "bg-accent"
                )}
              >
                <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{c.title || "Sin título"}</span>
                <Trash2
                  className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  onClick={(e) => handleDelete(c.id, e)}
                />
              </button>
            ))}
            {conversations.length === 0 && (
              <p className="px-2 py-4 text-xs text-muted-foreground">
                Sin conversaciones todavía. Escribí abajo para empezar.
              </p>
            )}
          </div>
        </ScrollArea>
      </aside>

      {/* Panel del chat */}
      <div className="flex min-w-0 flex-1 flex-col">
        {loadingConversation ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Cargando conversación...
          </div>
        ) : (
          <ChatPanel
            key={panelKey}
            conversationId={activeId}
            initialMessages={initialMessages}
            onConversationCreated={handleConversationCreated}
          />
        )}
      </div>
    </div>
  )
}
