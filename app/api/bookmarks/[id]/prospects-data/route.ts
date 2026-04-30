import { type NextRequest, NextResponse } from "next/server"
import { getProspectsTabData } from "@/app/actions/apollo"

/**
 * GET /api/bookmarks/[id]/prospects-data
 *
 * Endpoint dedicado para el tab de Prospectos. Se llama desde el cliente
 * via SWR, que deduplica requests, evita loops por remount y permite
 * revalidaciones controladas con `mutate`.
 */
// Forzamos runtime nodejs y dynamic para evitar que turbopack/cache devuelva
// un 404 fantasma cuando se modifica un modulo importado en profundidad.
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const data = await getProspectsTabData(id)
    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] /api/bookmarks/[id]/prospects-data failed:", error)
    return NextResponse.json(
      {
        error: "Error al cargar prospectos",
        message: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}
