-- =========================================================================
-- 436. CHECKPOINT DE ENRICHMENT DE COMPANIES VIA LINKEDIN (Apify)
-- =========================================================================
-- Actor: harvestapi/linkedin-company (id UwSdACBp7ymaGUJjS)
--
-- Vive en el schema v3 para no tocar nada de v2.
-- Sirve para: reanudar sin reprocesar, no volver a pagar por una empresa ya
-- consultada, y auditar que se escribio en cada fila.
--
-- run-sql.mjs es DRY RUN salvo --commit. No incluir COMMIT aca.
-- =========================================================================

CREATE TABLE IF NOT EXISTS v3.linkedin_company_enrichment (
  company_id     uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Que se le pidio al actor
  requested_url  text,
  mode           text NOT NULL DEFAULT 'companies'
                 CHECK (mode IN ('companies', 'searches')),

  -- Resultado
  status         text NOT NULL
                 CHECK (status IN ('ok', 'no_result', 'no_hq', 'error')),
  hq_iso         text,
  hq_country     text,
  hq_source      text CHECK (hq_source IN ('headquarter_flag', 'single_location', 'unanimous_country')),

  -- Payload crudo: permite reprocesar mapeos sin volver a pagar el run
  payload        jsonb,

  -- Que columnas de public.companies se llenaron efectivamente
  filled_columns text[] NOT NULL DEFAULT '{}',

  error_message  text,
  processed_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE v3.linkedin_company_enrichment IS
  'Checkpoint y auditoria del enrichment de public.companies via el actor harvestapi/linkedin-company. Una fila por empresa procesada.';

CREATE INDEX IF NOT EXISTS idx_li_enrich_status
  ON v3.linkedin_company_enrichment (status);

CREATE INDEX IF NOT EXISTS idx_li_enrich_processed_at
  ON v3.linkedin_company_enrichment (processed_at DESC);

DO $$
BEGIN
  RAISE NOTICE 'v3.linkedin_company_enrichment lista. Filas: %',
    (SELECT count(*) FROM v3.linkedin_company_enrichment);
END $$;
