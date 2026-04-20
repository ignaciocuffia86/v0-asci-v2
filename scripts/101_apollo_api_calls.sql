-- =============================================
-- Fase 3 - Observabilidad de llamadas a Apollo
-- =============================================
-- Se adelanta a Fase 1 porque es necesaria para validar paridad con la UI
-- (auditar cada request/response). Guarda metadata, no bodies completos.

CREATE TABLE IF NOT EXISTS public.apollo_api_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  bookmark_id UUID,
  company_id UUID,

  endpoint TEXT NOT NULL,              -- 'mixed_people/search' | 'people/match' | 'organizations/enrich' | 'webhook'
  request_body JSONB,                  -- Payload enviado (sin claves secretas)
  response_status INT,                 -- HTTP status
  response_total_entries INT,          -- total_entries devuelto por Apollo
  response_count INT,                  -- personas/orgs devueltas en esta llamada
  response_page INT,                   -- pagina solicitada (para busquedas paginadas)
  phone_revealed BOOLEAN DEFAULT FALSE,
  phone_sync BOOLEAN,                  -- true si phone llego sincrono, false si via webhook
  latency_ms INT,
  error TEXT,                          -- mensaje de error si fallo
  retry_count INT DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indices para las consultas tipicas:
-- 1. Debug por usuario/bookmark reciente
CREATE INDEX IF NOT EXISTS idx_apollo_api_calls_user_created
  ON public.apollo_api_calls (user_id, created_at DESC);

-- 2. Investigar una empresa especifica
CREATE INDEX IF NOT EXISTS idx_apollo_api_calls_company
  ON public.apollo_api_calls (company_id, created_at DESC);

-- 3. Metricas agregadas por endpoint
CREATE INDEX IF NOT EXISTS idx_apollo_api_calls_endpoint_created
  ON public.apollo_api_calls (endpoint, created_at DESC);

-- 4. Alertas de error rate
CREATE INDEX IF NOT EXISTS idx_apollo_api_calls_errors
  ON public.apollo_api_calls (created_at DESC)
  WHERE error IS NOT NULL OR response_status >= 400;

ALTER TABLE public.apollo_api_calls ENABLE ROW LEVEL SECURITY;

-- Lectura: solo admins (via funcion is_superadmin) y service_role
CREATE POLICY "Superadmins can read apollo api calls" ON public.apollo_api_calls
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('superadmin', 'admin')
    )
  );

-- Escritura: authenticated (las server actions usan el cliente autenticado)
CREATE POLICY "Authenticated can insert apollo api calls" ON public.apollo_api_calls
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Service role puede hacer todo
CREATE POLICY "Service role manages apollo api calls" ON public.apollo_api_calls
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.apollo_api_calls IS
  'Log de cada llamada a Apollo API. Sirve para auditar discrepancias reportadas por usuarios y alimentar metricas de paridad / costos.';
