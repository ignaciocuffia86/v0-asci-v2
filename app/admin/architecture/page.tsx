import type { Metadata } from "next"
import { ArchitectureFrame } from "./_components/architecture-frame"

export const metadata: Metadata = {
  title: "Mapa de arquitectura · Admin",
  description: "Diagrama interactivo de ASCI v2 y v3, flujos end-to-end y hallazgos de auditoría.",
  robots: { index: false, follow: false },
}

// ═══════════════════════════════════════════════════════════
// Esta página es deliberadamente un cascarón: NO lee
// docs/architecture-map.json en el árbol de React.
//
// Motivo (verificado en runtime): cualquier string leído durante el render
// termina en el flight stream (self.__next_f) del HTML, y eso ocurre incluso
// cuando el layout llama a redirect() para un usuario no-admin. Leer el JSON
// acá filtraba el mapa completo —hallazgos de seguridad incluidos— a usuarios
// anónimos, exactamente lo que esta ruta debe evitar.
//
// La lectura vive en ./asset/route.ts, que revalida superadmin antes de tocar
// el disco y nunca pasa por el renderer.
// ═══════════════════════════════════════════════════════════

export default function ArchitecturePage() {
  // El guard de superadmin lo aplica app/admin/layout.tsx.
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">Mapa de arquitectura</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground leading-relaxed">
            Diagrama interactivo de v2 y v3, sus zonas de contacto, flujos end-to-end y hallazgos de auditoría. Solo
            super-admins: el contenido describe fallas de seguridad reales, por eso no se publica en{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">public/</code>.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <a
            className="rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            href="/admin/architecture/asset?file=html"
            target="_blank"
            rel="noreferrer"
          >
            Abrir en pestaña nueva
          </a>
          <a
            className="rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            href="/admin/architecture/asset?file=json&download=1"
          >
            Descargar JSON
          </a>
        </div>
      </header>

      <p className="rounded-md border bg-muted/30 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
        Para regenerar el mapa después de cambios en el código, corré{" "}
        <code className="rounded bg-background px-1.5 py-0.5">node scripts/build-architecture-map.mjs</code>. Las fuentes
        viven en <code className="rounded bg-background px-1.5 py-0.5">docs/architecture-map.json</code> (datos, también
        consumible por agentes IA) y se renderizan en el HTML autocontenido.
      </p>

      <ArchitectureFrame src="/admin/architecture/asset?file=html" />
    </div>
  )
}
