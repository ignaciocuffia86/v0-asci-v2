import "server-only"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

/**
 * POST /api/v3/admin/normalize-country-phase5 — DESHABILITADA.
 *
 * Esta ruta escribía CÓDIGOS ISO en companies.country_normalized
 * (`update({ country_normalized: mapping.iso })`). Eso rompe el invariante de
 * la columna: country_normalized guarda el NOMBRE del país (lo que producen el
 * trigger normalize_country() y de lo que dependen los exports de v2). Escribir
 * ISO ahí corrompía los exports en silencio (cp_country).
 *
 * Se deshabilita en lugar de "arreglarla" porque:
 *  - No estaba agendada en vercel.json (era manual, Bearer CRON_SECRET).
 *  - El backfill de country_normalized ya lo cubre el trigger normalize_country()
 *    en cada write de `country`.
 *  - La migración 20260813000001 agrega un CHECK que además haría fallar
 *    cualquier escritura de ISO.
 *
 * Si en el futuro hace falta un backfill con IA para los valores que el trigger
 * no reconoce, debe persistir el NOMBRE canónico (no el ISO).
 */
export async function POST(_req: NextRequest): Promise<Response> {
  return NextResponse.json(
    {
      error: "disabled",
      reason:
        "normalize-country-phase5 escribía ISO en country_normalized, que debe ser el NOMBRE del país. Ruta deshabilitada (ver migración 20260813000001).",
    },
    { status: 410 },
  )
}
