/**
 * Setup global para vitest.
 * Aisla cada test de env vars reales y de llamadas de red accidentales.
 */
import { afterEach, beforeAll, vi } from "vitest"

beforeAll(() => {
  // ENV vars usados por lib/apollo/*
  process.env.APOLLO_API_KEY = process.env.APOLLO_API_KEY ?? "test_key"
  process.env.NEXT_PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://test.local"
  process.env.APOLLO_WEBHOOK_SECRET = process.env.APOLLO_WEBHOOK_SECRET ?? "test_secret"
})

afterEach(() => {
  vi.restoreAllMocks()
})
