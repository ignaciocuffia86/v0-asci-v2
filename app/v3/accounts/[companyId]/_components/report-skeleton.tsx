import { Card, CardContent, CardHeader } from "@/components/ui/card"

/**
 * Esqueleto de la radiografía mientras se arma en el servidor.
 *
 * Imita la forma real del informe —tarjetas apiladas con un título y unas
 * líneas— para que cuando llegue el contenido no salte el layout. La animación
 * es lo que le dice al usuario que hay algo pasando; antes de esto, la espera
 * era una pantalla congelada sin ninguna señal.
 */
export function ReportSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Armando la radiografía de la cuenta">
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardHeader className="pb-3">
            <div className="h-5 w-48 animate-pulse rounded bg-muted" />
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            <div className="h-4 w-full animate-pulse rounded bg-muted" />
            <div className="h-4 w-11/12 animate-pulse rounded bg-muted" />
            {/* La tercera línea más corta: un párrafo real termina antes del borde. */}
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
