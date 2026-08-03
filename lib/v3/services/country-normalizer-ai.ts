"use server"

import { generateText } from "ai"

// Usar IA Gateway + Gemini (modelo más barato: google/gemini-3.5-flash)
// El Gateway ofrece OpenAI-compatible API, así que usamos createOpenAI
async function normalizeCountryWithAI(ambiguousValues: string[]): Promise<
  Array<{ original: string; iso: string | null; confidence: number }>
> {
  if (ambiguousValues.length === 0) return []

  const BATCH_SIZE = 10 // Procesar de a 10 para economía de tokens

  const results: Array<{
    original: string
    iso: string | null
    confidence: number
  }> = []

  for (let i = 0; i < ambiguousValues.length; i += BATCH_SIZE) {
    const batch = ambiguousValues.slice(i, i + BATCH_SIZE)

    const prompt = `Eres un experto en normalización geográfica. Tu tarea es mapear nombres de lugares (ciudades, regiones, países) a códigos ISO 3166-1 alpha-2.

REGLAS:
1. Si reconoces claramente una ciudad/región, devuelve el ISO del país
2. Si es ambiguo, devuelve null
3. Devuelve EXACTAMENTE JSON, sin prefijo, sin markdown

Entrada (lista de lugares):
${batch.map((v, i) => `${i + 1}. "${v}"`).join("\n")}

Devuelve un JSON array exacto (sin markdown):
[
  {"original": "...", "iso": "XX", "confidence": 0.95},
  {"original": "...", "iso": null, "confidence": 0.1}
]

Códigos ISO comunes:
- Argentina: AR, Brasil: BR, Chile: CL, Colombia: CO, México: MX, Perú: PE
- Estados Unidos: US, Canadá: CA
- España: ES, Francia: FR, Alemania: DE, Italia: IT, Reino Unido: GB
- China: CN, India: IN, Japón: JP, Singapur: SG, Hong Kong: HK
- Luxemburgo: LU, Malta: MT, Portugal: PT
`

    try {
      const response = await generateText({
        // Usar el modelo más barato: gemini-2.5-flash-lite ($0.075/$0.30 per M tokens)
        // Es suficiente para esta tarea de clasificación simple
        model: "google/gemini-2.5-flash-lite",
        prompt,
        temperature: 0,
        maxOutputTokens: 500,
      })

      // Parse JSON de la respuesta
      const jsonMatch = response.text.match(/\[[\s\S]*\]/m)
      if (!jsonMatch) {
        console.warn("[country-normalizer-ai] No JSON found in response:", response.text.slice(0, 200))
        continue
      }

      const parsed = JSON.parse(jsonMatch[0])
      results.push(...parsed)
    } catch (error) {
      console.error("[country-normalizer-ai] Error processing batch:", error)
      // Fallback: devuelve null para todos en el batch
      batch.forEach((original) => {
        results.push({ original, iso: null, confidence: 0 })
      })
    }
  }

  return results
}

export { normalizeCountryWithAI }
