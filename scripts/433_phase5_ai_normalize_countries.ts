// Script para ejecutar Fase 5 (IA) offline: mapea ~290 valores ambiguos con Gemini via IA Gateway
// Uso: npx tsx scripts/433_phase5_ai_normalize_countries.ts

import { createClient } from "@supabase/supabase-js"
import { generateText } from "ai"

async function normalizeWithAI(unmappedValues: string[]): Promise<
  Array<{ original: string; iso: string | null; confidence: number }>
> {
  const BATCH_SIZE = 10
  const results: Array<{ original: string; iso: string | null; confidence: number }> = []

  for (let i = 0; i < unmappedValues.length; i += BATCH_SIZE) {
    const batch = unmappedValues.slice(i, i + BATCH_SIZE)
    
    const prompt = `Eres un experto en normalización geográfica. Mapea estos lugares a códigos ISO 3166-1 alpha-2:

${batch.map((v, i) => `${i + 1}. "${v}"`).join("\n")}

REGLAS:
- Si es una ciudad/región clara, devuelve el ISO del país
- Si es ambiguo, devuelve null
- SOLO devuelve JSON sin markdown, sin prefijo

Devuelve exactamente:
[
  {"original": "...", "iso": "XX", "confidence": 0.95}
]`

    try {
      console.log(`[FASE 5-IA] Procesando batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(unmappedValues.length / BATCH_SIZE)}...`)
      
      const { text } = await generateText({
        model: "google/gemini-2.5-flash-lite",
        prompt,
        temperature: 0,
        maxOutputTokens: 500,
      })

      const jsonMatch = text.match(/\[[\s\S]*\]/m)
      if (!jsonMatch) {
        console.warn("[FASE 5-IA] No JSON in response, skipping batch")
        continue
      }

      const parsed = JSON.parse(jsonMatch[0])
      results.push(...parsed)
      
      console.log(`[FASE 5-IA]   ✓ ${parsed.length} resultados`)
    } catch (error: any) {
      console.error("[FASE 5-IA] Error en batch:", error.message)
      batch.forEach((original) => {
        results.push({ original, iso: null, confidence: 0 })
      })
    }

    // Rate limiting: espera un poco entre batches
    if (i + BATCH_SIZE < unmappedValues.length) {
      await new Promise((r) => setTimeout(r, 1000))
    }
  }

  return results
}

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  )

  console.log("[FASE 5-IA] Iniciando normalización con Gemini via IA Gateway...")
  console.log(`[FASE 5-IA] Modelo: google/gemini-2.5-flash-lite (más barato)`)

  // 1. Obtener valores sin mapear
  const { data: rows, error } = await supabase
    .from("companies")
    .select("country")
    .is("country_normalized", null)
    .not("country", "is", null)
    .neq("country", "")

  if (error) {
    console.error("[FASE 5-IA] Error fetching:", error)
    process.exit(1)
  }

  const unmappedValues = [...new Set((rows || []).map((r: any) => r.country?.trim()).filter(Boolean))]
  console.log(`[FASE 5-IA] Encontrados ${unmappedValues.length} valores únicos sin mapear`)

  if (unmappedValues.length === 0) {
    console.log("[FASE 5-IA] ✓ Ya todo normalizado")
    return
  }

  // 2. Procesar con IA
  const results = await normalizeWithAI(unmappedValues)

  // 3. Filtrar válidos
  const valid = results.filter((r) => r.iso && r.iso.length === 2)
  console.log(`\n[FASE 5-IA] Mappings válidos: ${valid.length}/${results.length}`)

  if (valid.length === 0) {
    console.log("[FASE 5-IA] ⚠ Sin mappings")
    return
  }

  // 4. Persiste
  let updated = 0
  for (const { original, iso } of valid) {
    const { error: err } = await supabase
      .from("companies")
      .update({ country_normalized: iso })
      .eq("country", original)
      .is("country_normalized", null)

    if (!err) updated++
  }

  console.log(`[FASE 5-IA] ✓ Actualizado: ${updated}`)
  console.log(`[FASE 5-IA] Fin. Cobertura +${updated} empresas`)
}

main().catch(console.error)
