import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"

// Initialize Google Provider
const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || "",
})

// Initialize Perplexity Provider (via OpenAI compatible client)
const perplexity = createOpenAI({
  apiKey: process.env.PERPLEXITY_API_KEY || "",
  baseURL: "https://api.perplexity.ai",
})

export function getGeminiModel(version: "2.5" | "2.0" | "1.5" = "2.5") {
  // Map versions to specific model IDs
  // Note: 'gemini-2.5-flash' is the latest high-performance model
  // 'gemini-2.0-flash' is the stable previous version
  const modelMap = {
    "2.5": "gemini-2.5-flash",
    "2.0": "gemini-2.0-flash",
    "1.5": "gemini-2.0-flash", // 1.5 is deprecated, fallback to 2.0
  }

  return google(modelMap[version])
}

export function getPerplexityModel() {
  return perplexity("sonar-pro")
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
