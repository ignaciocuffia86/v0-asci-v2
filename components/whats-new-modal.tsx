"use client"

import { useState, useEffect } from "react"
import { X, Sliders, FileText, Filter, BookMarked, Search, Users, Download, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

const STORAGE_KEY = "asci-whats-new-marzo-2026-v1"

interface Feature {
  icon: React.ReactNode
  category: string
  title: string
  description: string
}

const FEATURES: Feature[] = [
  {
    icon: <Sliders className="h-4 w-4" />,
    category: "Prompts",
    title: "Limites y personalización de prompts",
    description:
      "Mejoras en la personalización de prompts con soporte de límites de caracteres para LinkedIn, para que los mensajes generados se ajusten siempre al canal.",
  },
  {
    icon: <FileText className="h-4 w-4" />,
    category: "Documentos",
    title: "Seleccion de documentos por bookmark",
    description:
      "Ahora podés elegir qué propuestas de valor y casos de éxito aplican a cada bookmark. La estrategia y los icebreakers se generan en base a los documentos que selecciones.",
  },
  {
    icon: <Filter className="h-4 w-4" />,
    category: "Busqueda",
    title: "Filtro por industria post-busqueda",
    description:
      "Luego de buscar por tecnología o proceso, podés filtrar los resultados por industria sin perder el contexto de la búsqueda original.",
  },
  {
    icon: <Sparkles className="h-4 w-4" />,
    category: "IA",
    title: "Insights reformulados desde documentos",
    description:
      "Los icebreakers y el contexto de expansión ahora reescriben los puntos clave de tus documentos en lugar de citarlos literalmente, generando mensajes más naturales y convincentes.",
  },
  {
    icon: <Search className="h-4 w-4" />,
    category: "Busqueda",
    title: "Busqueda multi-tecnologia",
    description:
      "Seleccioná varias tecnologías al mismo tiempo. Con \"Al menos una\" ampliás la cobertura; con \"Todas a la vez\" encontrás empresas que usan todo el stack simultáneamente.",
  },
  {
    icon: <Users className="h-4 w-4" />,
    category: "Señales",
    title: "Filtrado de señales por personas en el drawer",
    description:
      "En el panel lateral de cada empresa podés filtrar los empleados actuales, alumni y búsquedas laborales por señal, viendo exactamente quién está relacionado con cada tecnología o proceso.",
  },
  {
    icon: <Download className="h-4 w-4" />,
    category: "Exportacion",
    title: "Exportar bookmark a Excel",
    description:
      "Exportá desde cualquier workspace los contactos del bookmark junto con los datos de la empresa a un archivo Excel, listo para usar fuera de la plataforma.",
  },
]

const CATEGORY_COLORS: Record<string, string> = {
  Prompts:     "bg-blue-50 text-blue-700 border-blue-100",
  Documentos:  "bg-violet-50 text-violet-700 border-violet-100",
  Busqueda:    "bg-sky-50 text-sky-700 border-sky-100",
  IA:          "bg-emerald-50 text-emerald-700 border-emerald-100",
  "Señales":   "bg-amber-50 text-amber-700 border-amber-100",
  Exportacion: "bg-slate-50 text-slate-600 border-slate-200",
}

export function WhatsNewModal() {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  useEffect(() => {
    try {
      const seen = localStorage.getItem(STORAGE_KEY)
      if (!seen) setOpen(true)
    } catch {
      // localStorage not available
    }
  }, [])

  const handleClose = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1")
    } catch {
      // ignore
    }
    setOpen(false)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in-0 zoom-in-95 duration-200">

        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-5 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <BookMarked className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-foreground leading-none">
                  Novedades Marzo
                </h2>
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary leading-none">
                  2026
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {FEATURES.length} mejoras disponibles desde hoy
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0 -mt-0.5 -mr-1"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Cerrar</span>
          </button>
        </div>

        {/* Feature list */}
        <div className="overflow-y-auto flex-1 px-3 py-3">
          <div className="space-y-0.5">
            {FEATURES.map((feature, i) => (
              <button
                key={i}
                onClick={() => setActiveIndex(activeIndex === i ? null : i)}
                className={cn(
                  "w-full text-left rounded-lg px-3 py-3 transition-colors group",
                  activeIndex === i
                    ? "bg-muted"
                    : "hover:bg-muted/60",
                )}
              >
                {/* Row */}
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div
                    className={cn(
                      "h-7 w-7 rounded-md flex items-center justify-center shrink-0 mt-0.5 border",
                      activeIndex === i
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted text-muted-foreground border-border group-hover:bg-primary/10 group-hover:text-primary group-hover:border-primary/20 transition-colors",
                    )}
                  >
                    {feature.icon}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={cn(
                          "inline-flex items-center rounded border px-1.5 py-px text-[10px] font-medium leading-none",
                          CATEGORY_COLORS[feature.category] ?? "bg-muted text-muted-foreground border-border",
                        )}
                      >
                        {feature.category}
                      </span>
                      <span className="text-sm font-medium text-foreground leading-snug">
                        {feature.title}
                      </span>
                    </div>

                    {/* Expandable description */}
                    {activeIndex === i && (
                      <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                        {feature.description}
                      </p>
                    )}
                  </div>

                  {/* Expand indicator */}
                  <div className={cn(
                    "shrink-0 mt-1 w-4 h-4 text-muted-foreground transition-transform duration-150",
                    activeIndex === i && "rotate-180",
                  )}>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border shrink-0 flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            Hace clic en cada item para ver el detalle
          </p>
          <button
            onClick={handleClose}
            className="shrink-0 px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors"
          >
            Explorar
          </button>
        </div>
      </div>
    </div>
  )
}
