// Tipo compartido para Implementaciones (v1 legacy y v2 Tech Radar)
export interface Implementation {
  id: string
  title: string
  provider_name: string | null
  technology: string | null
  area: string | null
  summary: string | null
  results: string | null
  evidence_level: string | null
  source_url: string | null
  source_name: string | null
  published_at: string | null
  created_at: string

  // Campos del Tech Radar v2 (migracion 161)
  micro_agent: string | null
  evidence_detail: string | null
  convergent_sources: number | null
  supporting_source_urls: unknown // jsonb -> array de strings
  prompt_version: string | null
}
