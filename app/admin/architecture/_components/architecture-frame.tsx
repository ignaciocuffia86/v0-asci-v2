"use client"

import { useRef, useState } from "react"
import { Maximize2, Minimize2 } from "lucide-react"

export function ArchitectureFrame({ src }: { src: string }) {
  const contenedor = useRef<HTMLDivElement>(null)
  const [expandido, setExpandido] = useState(false)

  async function alternar() {
    const el = contenedor.current
    if (!el) return
    // Fullscreen nativo cuando está disponible; si falla, caemos a un modo expandido por CSS.
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen()
        setExpandido(true)
      } else {
        await document.exitFullscreen()
        setExpandido(false)
      }
    } catch {
      setExpandido((v) => !v)
    }
  }

  return (
    <div
      ref={contenedor}
      className={
        expandido
          ? "fixed inset-0 z-50 bg-background"
          : "relative overflow-hidden rounded-md border bg-background"
      }
    >
      <button
        type="button"
        onClick={alternar}
        aria-label={expandido ? "Salir de pantalla completa" : "Ver en pantalla completa"}
        className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-md border bg-background/90 px-2.5 py-1.5 text-xs font-medium backdrop-blur transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        {expandido ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        {expandido ? "Salir" : "Pantalla completa"}
      </button>
      <iframe
        src={src}
        title="Mapa de arquitectura de ASCI v2 y v3"
        className={expandido ? "size-full border-0" : "h-[78vh] min-h-[520px] w-full border-0"}
        // El mapa es un archivo propio y estático: sin scripts remotos ni formularios.
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  )
}
