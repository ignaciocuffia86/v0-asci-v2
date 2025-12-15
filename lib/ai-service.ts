export async function generateGeminiContent(
  prompt: string,
  model = "gemini-2.0-flash",
  temperature = 0.7,
): Promise<string> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  if (!apiKey) throw new Error("Google API Key is missing")

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  console.log(`[v0] Sending request to Gemini (${model})...`)

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: temperature,
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[v0] Gemini API Error (${response.status}):`, errorText)
      throw new Error(`Gemini API Failed: ${response.status} - ${errorText}`)
    }

    const data = await response.json()

    // Safety check for empty response
    if (!data.candidates || data.candidates.length === 0) {
      console.error("[v0] Gemini returned no candidates:", JSON.stringify(data))
      return ""
    }

    const text = data.candidates[0].content.parts[0].text
    return text || ""
  } catch (error: any) {
    console.error("[v0] Network/Parsing Error in generateGeminiContent:", error)
    throw error
  }
}

export async function generatePerplexityContent(
  prompt: string,
  model = "sonar-pro",
  systemPrompt?: string,
): Promise<string> {
  const apiKey = process.env.PERPLEXITY_API_KEY
  if (!apiKey) throw new Error("Perplexity API Key is missing")

  console.log(`[v0] Sending request to Perplexity (${model})...`)

  try {
    const messages: Array<{ role: string; content: string }> = []

    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt })
    }
    messages.push({ role: "user", content: prompt })

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[v0] Perplexity API Error (${response.status}):`, errorText)
      throw new Error(`Perplexity API Failed: ${response.status} - ${errorText}`)
    }

    const data = await response.json()

    if (!data.choices || data.choices.length === 0) {
      console.error("[v0] Perplexity returned no choices:", JSON.stringify(data))
      return ""
    }

    return data.choices[0].message.content || ""
  } catch (error: any) {
    console.error("[v0] Network/Parsing Error in generatePerplexityContent:", error)
    throw error
  }
}

export function debugAIConfiguration() {
  const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  const perplexityKey = process.env.PERPLEXITY_API_KEY

  console.log("[v0] --- AI Configuration Check ---")
  console.log(
    "[v0] Google API Key Status:",
    googleKey ? `Present (Starts with: ${googleKey.substring(0, 4)}...)` : "MISSING",
  )
  console.log(
    "[v0] Perplexity API Key Status:",
    perplexityKey ? `Present (Starts with: ${perplexityKey.substring(0, 4)}...)` : "MISSING",
  )
  console.log("[v0] ------------------------------")

  return {
    hasGoogle: !!googleKey,
    hasPerplexity: !!perplexityKey,
  }
}
