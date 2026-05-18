"use client"

import { X, MessageSquare, Sparkles, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

interface CopilotPanelProps {
  onClose: () => void
}

export function CopilotPanel({ onClose }: CopilotPanelProps) {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-primary" />
          <span className="font-semibold">Copilot</span>
          <Badge variant="secondary" className="text-xs">Beta</Badge>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>
      
      {/* Coming Soon Content */}
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="rounded-full bg-primary/10 p-4">
          <MessageSquare className="size-8 text-primary" />
        </div>
        
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">Proximamente</h3>
          <p className="text-sm text-muted-foreground">
            El copiloto de ventas te ayudara con:
          </p>
        </div>
        
        <ul className="space-y-3 text-left text-sm">
          <li className="flex items-start gap-2">
            <div className="mt-0.5 size-5 rounded-full bg-green-500/10 p-1">
              <Sparkles className="size-3 text-green-500" />
            </div>
            <span className="text-muted-foreground">
              <strong className="text-foreground">Icebreakers</strong> personalizados basados en senales
            </span>
          </li>
          <li className="flex items-start gap-2">
            <div className="mt-0.5 size-5 rounded-full bg-blue-500/10 p-1">
              <Sparkles className="size-3 text-blue-500" />
            </div>
            <span className="text-muted-foreground">
              <strong className="text-foreground">Recomendaciones</strong> de cargos a contactar
            </span>
          </li>
          <li className="flex items-start gap-2">
            <div className="mt-0.5 size-5 rounded-full bg-purple-500/10 p-1">
              <Sparkles className="size-3 text-purple-500" />
            </div>
            <span className="text-muted-foreground">
              <strong className="text-foreground">Feedback</strong> sobre tus campanas
            </span>
          </li>
          <li className="flex items-start gap-2">
            <div className="mt-0.5 size-5 rounded-full bg-amber-500/10 p-1">
              <Sparkles className="size-3 text-amber-500" />
            </div>
            <span className="text-muted-foreground">
              <strong className="text-foreground">Borradores</strong> de emails para aprobar
            </span>
          </li>
        </ul>
        
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="size-3" />
          <span>Disponible en proxima version</span>
        </div>
      </div>
    </div>
  )
}
