import { Card, CardContent, CardHeader } from "@/components/ui/card"

/**
 * Pantalla de carga de una cuenta.
 *
 * ── Por qué existe ──
 * Sin un `loading.tsx`, el App Router espera la respuesta COMPLETA del servidor
 * antes de cambiar de página: el navegador se queda en la pantalla anterior,
 * sin spinner ni feedback. Eso es lo que se reportaba como "se freezó" al
 * entrar a una cuenta. La página no tardaba en pintar — no empezaba a pintar.
 *
 * v2 ya tenía estos boundaries (`app/bookmarks/[id]/loading.tsx`); v3 no tenía
 * ninguno.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6 p-6" aria-busy="true" aria-label="Cargando la cuenta">
      {/* Encabezado: nombre, metadatos y acciones */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="h-8 w-64 animate-pulse rounded bg-muted" />
          <div className="h-4 w-80 animate-pulse rounded bg-muted" />
        </div>
        <div className="flex gap-2">
          <div className="h-10 w-36 animate-pulse rounded-md bg-muted" />
          <div className="h-10 w-24 animate-pulse rounded-md bg-muted" />
        </div>
      </div>

      {/* Secciones del informe */}
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardHeader className="pb-3">
            <div className="h-5 w-48 animate-pulse rounded bg-muted" />
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            <div className="h-4 w-full animate-pulse rounded bg-muted" />
            <div className="h-4 w-11/12 animate-pulse rounded bg-muted" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
