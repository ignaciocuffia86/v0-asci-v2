"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { createClient } from "@/lib/supabase/client"
import { RefreshCw } from "lucide-react"

type DebugEvent = {
  id: string
  event_type: string
  message: string
  details?: Record<string, unknown>
  created_at: string
}

export function ProcessingLogs() {
  const [events, setEvents] = useState<DebugEvent[]>([])
  const logsEndRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  const fetchLogs = async () => {
    const { data } = await supabase
      .from("debug_events")
      .select("id, event_type, message, details, created_at")
      .order("created_at", { ascending: false })
      .limit(30)

    if (data) {
      setEvents(data)
    }
  }

  useEffect(() => {
    fetchLogs()
    const interval = setInterval(fetchLogs, 3000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [events])

  const getEventColor = (eventType: string) => {
    if (eventType.includes("error") || eventType.includes("failed")) return "destructive"
    if (eventType.includes("completed")) return "default"
    if (eventType.includes("processing") || eventType.includes("chunk")) return "secondary"
    return "outline"
  }

  const getEventIcon = (eventType: string) => {
    if (eventType.includes("error")) return "❌"
    if (eventType.includes("completed")) return "✅"
    if (eventType.includes("processing")) return "⚙️"
    if (eventType.includes("chunk")) return "📦"
    return "📋"
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Logs de Procesamiento</CardTitle>
          <button onClick={fetchLogs} className="p-1 hover:bg-muted rounded transition-colors" title="Actualizar logs">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-2 max-h-[400px] overflow-y-auto font-mono text-xs">
          {events.length === 0 ? (
            <div className="text-muted-foreground text-center py-8">Sin eventos recientes</div>
          ) : (
            events.map((event) => (
              <div
                key={event.id}
                className="p-2 bg-muted/50 rounded border border-muted hover:border-muted-foreground/50 transition-colors"
              >
                <div className="flex items-start gap-2">
                  <span className="text-lg mt-0.5">{getEventIcon(event.event_type)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-muted-foreground">
                        {new Date(event.created_at).toLocaleTimeString("es-AR")}
                      </span>
                      <Badge variant={getEventColor(event.event_type)} className="text-xs capitalize">
                        {event.event_type.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <div className="mt-1 text-foreground break-words">{event.message}</div>
                    {event.details && (
                      <div className="mt-1 text-muted-foreground">
                        <details className="cursor-pointer">
                          <summary className="hover:text-foreground">Detalles</summary>
                          <pre className="mt-1 bg-background p-1 rounded text-xs overflow-x-auto">
                            {JSON.stringify(event.details, null, 2)}
                          </pre>
                        </details>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </CardContent>
    </Card>
  )
}
