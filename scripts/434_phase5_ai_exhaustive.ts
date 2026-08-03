// Script para ejecutar Fase 5 IA EXHAUSTIVA: procesa TODOS los valores sin normalizar
// con IA Gateway + Gemini 2.5 Flash Lite (modelo más barato)
// Uso: npx tsx scripts/434_phase5_ai_exhaustive.ts

import { createClient } from "@supabase/supabase-js"
import { generateText } from "ai"

async function normalizeWithAIExhaustive(unmappedValues: string[]): Promise<
  Array<{ original: string; iso: string | null; confidence: number }>
> {
  const BATCH_SIZE = 10
  const results: Array<{ original: string; iso: string | null; confidence: number }> = []

  for (let i = 0; i < unmappedValues.length; i += BATCH_SIZE) {
    const batch = unmappedValues.slice(i, i + BATCH_SIZE)

    // Prompt mejorado: es específico sobre geografía y pone énfasis en precisión
    const prompt = `Eres un experto en geografía. Tu tarea es mapear ubicaciones a códigos ISO 3166-1 alpha-2.

ENTRADA (ubicaciones a normalizar):
${batch.map((v, idx) => `${idx + 1}. "${v}"`).join("\n")}

REGLAS CRÍTICAS:
- "Santiago Metropolitan Area" → "CL" (Chile)
- "Greater Buenos Aires" → "AR" (Argentina)
- "Lima Metropolitan Area" → "PE" (Perú)
- Las ciudades/regiones se mapean al país que contienen
- Si NO PUEDES identificar el país con seguridad: devuelve null
- Devuelve SOLO JSON válido, sin markdown ni prefijo

FORMATO EXACTO (JSON array):
[
  {"original": "...", "iso": "XX", "confidence": 0.95},
  {"original": "...", "iso": null, "confidence": 0}
]`

    try {
      const batchNum = Math.floor(i / BATCH_SIZE) + 1
      const totalBatches = Math.ceil(unmappedValues.length / BATCH_SIZE)
      console.log(`[FASE 5-IA] Batch ${batchNum}/${totalBatches} (${batch.length} valores)...`)

      const { text } = await generateText({
        model: "google/gemini-2.5-flash-lite",
        prompt,
        temperature: 0,
        maxOutputTokens: 600,
      })

      // Extrae JSON del response (puede venir con markdown)
      const jsonMatch = text.match(/\[[\s\S]*\]/m)
      if (!jsonMatch) {
        console.warn(`[FASE 5-IA]   ⚠ Sin JSON en respuesta, asignando null`)
        batch.forEach((original) => {
          results.push({ original, iso: null, confidence: 0 })
        })
        continue
      }

      const parsed = JSON.parse(jsonMatch[0])
      results.push(...parsed)

      const valid = parsed.filter((p: any) => p.iso?.length === 2)
      console.log(`[FASE 5-IA]   ✓ ${valid.length}/${batch.length} mapeados correctamente`)
    } catch (error: any) {
      console.error(`[FASE 5-IA]   ✗ Error en batch: ${error.message}`)
      // Fallback: asigna null a todos del batch
      batch.forEach((original) => {
        results.push({ original, iso: null, confidence: 0 })
      })
    }

    // Rate limiting: espera entre batches
    if (i + BATCH_SIZE < unmappedValues.length) {
      await new Promise((r) => setTimeout(r, 1500))
    }
  }

  return results
}

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  )

  console.log("[FASE 5-IA] ========================================")
  console.log("[FASE 5-IA] FASE 5 IA EXHAUSTIVA")
  console.log("[FASE 5-IA] Modelo: google/gemini-2.5-flash-lite (más barato)")
  console.log("[FASE 5-IA] ========================================\n")

  // 1. Obtener TODOS los valores sin normalizar
  const { data: rows, error } = await supabase
    .from("companies")
    .select("country")
    .is("country_normalized", null)
    .not("country", "is", null)
    .neq("country", "")

  if (error) {
    console.error("[FASE 5-IA] Error fetching countries:", error)
    process.exit(1)
  }

  // 2. Extraer valores únicos
  const unmappedValues = [...new Set((rows || []).map((r: any) => r.country?.trim()).filter(Boolean))].sort()
  console.log(`[FASE 5-IA] Total valores sin normalizar: ${unmappedValues.length}\n`)

  if (unmappedValues.length === 0) {
    console.log("[FASE 5-IA] ✓ YA TODOS NORMALIZADOS\n")
    return
  }

  // Mostrar los primeros valores para validar
  console.log(`[FASE 5-IA] Muestra de valores (primeros 10):`)
  unmappedValues.slice(0, 10).forEach((v) => console.log(`  - ${v}`))
  console.log("")

  // 3. Procesar con IA
  const results = await normalizeWithAIExhaustive(unmappedValues)

  // 4. Estadísticas
  const valid = results.filter((r) => r.iso && r.iso.length === 2)
  const invalid = results.filter((r) => !r.iso || r.iso.length !== 2)

  console.log(`\n[FASE 5-IA] ========================================`)
  console.log(`[FASE 5-IA] RESULTADOS`)
  console.log(`[FASE 5-IA] Totales procesados: ${results.length}`)
  console.log(`[FASE 5-IA] Válidos (ISO): ${valid.length} (${((valid.length / results.length) * 100).toFixed(1)}%)`)
  console.log(`[FASE 5-IA] Sin mapear: ${invalid.length}`)

  if (valid.length === 0) {
    console.log(`[FASE 5-IA] ⚠ Sin mappings válidos, abortando`)
    return
  }

  console.log(`[FASE 5-IA] ========================================\n`)

  // 5. Persistir en BD
  console.log(`[FASE 5-IA] Persistiendo en BD...`)
  let updated = 0
  let failed = 0

  for (const { original, iso } of valid) {
    if (!iso || iso.length !== 2) continue

    const { error: err } = await supabase
      .from("companies")
      .update({ country_normalized: iso })
      .eq("country", original)
      .is("country_normalized", null)

    if (err) {
      console.warn(`[FASE 5-IA]   ✗ Error en "${original}": ${err.message}`)
      failed++
    } else {
      updated++
    }
  }

  console.log(`\n[FASE 5-IA] ========================================`)
  console.log(`[FASE 5-IA] PERSISTENCIA`)
  console.log(`[FASE 5-IA] Actualizado: ${updated} empresas`)
  console.log(`[FASE 5-IA] Fallido: ${failed}`)
  console.log(`[FASE 5-IA] ========================================`)
  console.log(`[FASE 5-IA] ✓ FASE 5 IA EXHAUSTIVA COMPLETADA\n`)
}

main().catch(console.error)
