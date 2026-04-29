-- ============================================================================
-- 162: Landing stats
-- ----------------------------------------------------------------------------
-- Tabla singleton (id = 1) que guarda los 4 valores publicos de la home:
--   * contacts_analyzed       -> count(public.contacts)
--   * companies_indexed       -> count(public.companies)
--   * technologies_processes  -> count(dictionary_products) + count(dictionary_processes)
--   * signals_detected        -> count(public.signals)
--
-- Mantenida por la funcion refresh_landing_stats(). Se invoca desde:
--   - el cron semanal (lunes 5 AM UTC) en /api/cron/refresh-landing-stats
--   - manualmente al deploy o cuando se quiera forzar (super admin)
--
-- Lectura: publica (anon) para que la landing pueda leer sin auth.
-- Escritura: solo via funcion (SECURITY DEFINER). El cron usa service role.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.landing_stats (
  id INT PRIMARY KEY DEFAULT 1,
  contacts_analyzed BIGINT NOT NULL DEFAULT 0,
  companies_indexed BIGINT NOT NULL DEFAULT 0,
  technologies_processes INT NOT NULL DEFAULT 0,
  signals_detected BIGINT NOT NULL DEFAULT 0,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT landing_stats_singleton CHECK (id = 1)
);

ALTER TABLE public.landing_stats ENABLE ROW LEVEL SECURITY;

-- Lectura publica (cualquiera, incluso anon, puede ver los stats agregados)
DROP POLICY IF EXISTS "landing_stats_public_read" ON public.landing_stats;
CREATE POLICY "landing_stats_public_read" ON public.landing_stats
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Funcion que recalcula y upsert-ea los stats. SECURITY DEFINER para poder
-- escribir aunque el caller sea anon, y para ejecutar los counts contra
-- tablas con RLS activa.
CREATE OR REPLACE FUNCTION public.refresh_landing_stats()
RETURNS public.landing_stats
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contacts BIGINT;
  v_companies BIGINT;
  v_tech_proc INT;
  v_signals BIGINT;
  v_row public.landing_stats;
BEGIN
  SELECT COUNT(*) INTO v_contacts FROM public.contacts;
  SELECT COUNT(*) INTO v_companies FROM public.companies;
  SELECT
    (SELECT COUNT(*) FROM public.dictionary_products)
    + (SELECT COUNT(*) FROM public.dictionary_processes)
  INTO v_tech_proc;
  SELECT COUNT(*) INTO v_signals FROM public.signals;

  INSERT INTO public.landing_stats (
    id,
    contacts_analyzed,
    companies_indexed,
    technologies_processes,
    signals_detected,
    refreshed_at
  )
  VALUES (1, v_contacts, v_companies, v_tech_proc, v_signals, NOW())
  ON CONFLICT (id) DO UPDATE SET
    contacts_analyzed       = EXCLUDED.contacts_analyzed,
    companies_indexed       = EXCLUDED.companies_indexed,
    technologies_processes  = EXCLUDED.technologies_processes,
    signals_detected        = EXCLUDED.signals_detected,
    refreshed_at            = EXCLUDED.refreshed_at
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- Permitir que cualquiera (anon) ejecute la funcion no es deseable, asi
-- que solo service_role puede llamarla. RPC desde anon devolveria 403.
REVOKE EXECUTE ON FUNCTION public.refresh_landing_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_landing_stats() TO service_role;

-- Seed inicial: corremos la funcion una vez para popular la fila.
SELECT public.refresh_landing_stats();
