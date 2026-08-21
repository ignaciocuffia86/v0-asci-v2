import { Card, CardContent } from "@/components/ui/card"

/**
 * Pantalla de carga del listado de cuentas seguidas.
 *
 * Importa tanto como la de la cuenta: **volver** al listado también se sentía
 * congelado. `getRecentlyResearchedAccounts` resuelve hasta 12 empresas y cada
 * una hace 4 queries contra São Paulo, así que salir de una cuenta era tan caro
 * como entrar — y sin boundary, todo ese tiempo transcurría en la pantalla que
 * el usuario estaba dejando.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6 p-6" aria-busy="true" aria-label="Cargando las cuentas seguidas">
      <div className="flex flex-col gap-2">
        <div className="h-8 w-56 animate-pulse rounded bg-muted" />
        <div className="h-4 w-96 animate-pulse rounded bg-muted" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Card key={i}>
            <CardContent className="flex flex-col gap-3 pt-6">
              <div className="flex items-center gap-3">
                <div className="size-10 shrink-0 animate-pulse rounded-md bg-muted" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                </div>
              </div>
              <div className="h-3 w-full animate-pulse rounded bg-muted" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
