import "server-only"
import type { NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { normalizeCountries } from "@/lib/v3/services/country-normalizer"

/**
 * POST /api/v3/admin/normalize-country-phase5
 *
 * Ejecuta FASE 5: normalización con IA para los ~500 valores sin mapeo.
 *
 * Flujo:
 * 1. Obtén todos los valores únicos sin country_normalized (después de Fases 1-4)
 * 2. Pásalos por normalizeCountries() (heurística → IA)
 * 3. Persiste los resultados en bulk UPDATE
 * 4. Retorna estadísticas
 *
 * Seguridad: verifica header de autenticación (CRON_SECRET o Bearer token)
 *
 * Uso (manual):
 *   curl -X POST http://localhost:3000/api/v3/admin/normalize-country-phase5 \
 *     -H "Authorization: Bearer YOUR_SECRET" \
 *     -H "Content-Type: application/json"
 *
 * Uso (Vercel Cron):
 *   // En vercel.json o next.config.js
 *   { "path": "/api/v3/admin/normalize-country-phase5", "schedule": "0 2 * * *" }
 */

interface NormalizationResult {
  totalUnmapped: number
  normalized: number
  failed: number
  confidence: {
    high: number
    medium: number
    low: number
  }
  duration: number
  timestamp: string
}

async function getUnmappedCountries(): Promise<string[]> {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data, error } = await supabase
    .from("companies")
    .select("country")
    .filter("country_normalized", "is", null)
    .filter("country", "not.is", null)
    .not("country", "eq", "")
    .limit(500) // Safety limit

  if (error) throw error

  // Deduplica valores únicos
  const unique = new Set<string>()
  for (const row of data || []) {
    if (row.country && typeof row.country === "string") {
      const trimmed = row.country.trim()
      if (trimmed) unique.add(trimmed)
    }
  }

  return Array.from(unique)
}

async function persistNormalizations(
  mappings: Array<{ country: string; iso: string; confidence: string }>,
) {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  let updated = 0
  let failed = 0

  for (const mapping of mappings) {
    const { error } = await supabase
      .from("companies")
      .update({ country_normalized: mapping.iso })
      .filter("country", "eq", mapping.country)
      .filter("country_normalized", "is", null) // No sobrescribir

    if (error) {
      console.error(`[normalize-phase5] Error actualizando ${mapping.country}:`, error)
      failed++
    } else {
      updated++
    }
  }

  return { updated, failed }
}

export async function POST(req: NextRequest): Promise<Response> {
  const start = Date.now()

  try {
    // Verificación mínima de seguridad
    const auth = req.headers.get("authorization")
    const expectedSecret = process.env.CRON_SECRET || process.env.API_SECRET
    if (!expectedSecret || !auth?.startsWith(`Bearer ${expectedSecret}`)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    console.log("[normalize-phase5] Iniciando Fase 5 (IA)...")

    // Paso 1: Obtén valores sin mapear
    const unmapped = await getUnmappedCountries()
    console.log(`[normalize-phase5] Encontrados ${unmapped.length} valores únicos sin mapear`)

    if (unmapped.length === 0) {
      return Response.json(
        {
          message: "No hay valores sin normalizar",
          totalUnmapped: 0,
          normalized: 0,
          failed: 0,
          duration: Date.now() - start,
        },
        { status: 200 },
      )
    }

    // Paso 2: Normaliza con IA + heurística
    console.log(`[normalize-phase5] Procesando ${unmapped.length} valores con IA...`)
    const results = await normalizeCountries(unmapped)

    const confidence = { high: 0, medium: 0, low: 0 }
    for (const r of results) {
      confidence[r.confidence as keyof typeof confidence]++
    }

    // Paso 3: Persiste en BD
    console.log(`[normalize-phase5] Persistiendo ${results.length} normalizaciones...`)
    const { updated, failed } = await persistNormalizations(
      results.map((r) => ({
        country: r.country,
        iso: r.iso,
        confidence: r.confidence,
      })),
    )

    const duration = Date.now() - start

    const response: NormalizationResult = {
      totalUnmapped: unmapped.length,
      normalized: updated,
      failed: failed,
      confidence,
      duration,
      timestamp: new Date().toISOString(),
    }

    console.log(
      `[normalize-phase5] Completado en ${duration}ms. Normalizadas: ${updated}, Fallidas: ${failed}`,
    )

    return Response.json(response, { status: 200 })
  } catch (error) {
    console.error("[normalize-phase5] Error:", error)
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
        duration: Date.now() - start,
      },
      { status: 500 },
    )
  }
}
