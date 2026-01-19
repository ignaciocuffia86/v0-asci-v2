-- =============================================
-- Dashboard Improvements: Fase 1
-- Tabla cron_executions + RPC get_dashboard_counts
-- =============================================

-- 1. Crear tabla para tracking de ejecuciones de CRON
CREATE TABLE IF NOT EXISTS cron_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cron_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  records_processed INTEGER DEFAULT 0,
  records_failed INTEGER DEFAULT 0,
  signals_created INTEGER DEFAULT 0,
  error_message TEXT,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_cron_executions_name ON cron_executions(cron_name);
CREATE INDEX IF NOT EXISTS idx_cron_executions_started ON cron_executions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_executions_name_started ON cron_executions(cron_name, started_at DESC);

-- 2. Agregar updated_at a diccionarios si no existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dictionary_processes' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE dictionary_processes ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dictionary_products' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE dictionary_products ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
  END IF;
END $$;

-- 3. Trigger para auto-update de updated_at
CREATE OR REPLACE FUNCTION update_dictionary_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_dictionary_processes_updated ON dictionary_processes;
CREATE TRIGGER trigger_dictionary_processes_updated
  BEFORE UPDATE ON dictionary_processes
  FOR EACH ROW EXECUTE FUNCTION update_dictionary_timestamp();

DROP TRIGGER IF EXISTS trigger_dictionary_products_updated ON dictionary_products;
CREATE TRIGGER trigger_dictionary_products_updated
  BEFORE UPDATE ON dictionary_products
  FOR EACH ROW EXECUTE FUNCTION update_dictionary_timestamp();

-- 4. RPC para conteos eficientes (sin cap de 1000)
CREATE OR REPLACE FUNCTION get_dashboard_counts()
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'signals_total', (SELECT COUNT(*) FROM signals),
    'signals_process', (SELECT COUNT(*) FROM signals WHERE signal_type = 'process'),
    'signals_technology', (SELECT COUNT(*) FROM signals WHERE signal_type = 'technology'),
    'contacts_total', (SELECT COUNT(*) FROM contacts),
    'companies_total', (SELECT COUNT(*) FROM companies),
    'dictionary_processes', (SELECT COUNT(*) FROM dictionary_processes),
    'dictionary_products', (SELECT COUNT(*) FROM dictionary_products),
    'dictionary_vendors', (SELECT COUNT(*) FROM dictionary_vendors),
    'jobs_pending', (SELECT COUNT(*) FROM dictionary_jobs WHERE status = 'pending'),
    'jobs_processing', (SELECT COUNT(*) FROM dictionary_jobs WHERE status = 'processing'),
    'jobs_completed', (SELECT COUNT(*) FROM dictionary_jobs WHERE status = 'completed'),
    'jobs_failed', (SELECT COUNT(*) FROM dictionary_jobs WHERE status = 'failed'),
    'keywords_process', (SELECT COALESCE(SUM(array_length(keywords, 1)), 0) FROM dictionary_processes),
    'keywords_technology', (SELECT COALESCE(SUM(array_length(keywords, 1)), 0) FROM dictionary_products),
    'batches_pending', (SELECT COUNT(*) FROM import_batches WHERE status = 'pending'),
    'batches_processing', (SELECT COUNT(*) FROM import_batches WHERE status = 'processing'),
    'batches_completed', (SELECT COUNT(*) FROM import_batches WHERE status = 'completed'),
    'batches_failed', (SELECT COUNT(*) FROM import_batches WHERE status = 'failed')
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. RPC para obtener estado de CRONs
CREATE OR REPLACE FUNCTION get_cron_status()
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'process_dictionary', (
      SELECT jsonb_build_object(
        'status', COALESCE(status, 'unknown'),
        'started_at', started_at,
        'completed_at', completed_at,
        'records_processed', records_processed,
        'error_message', error_message
      )
      FROM cron_executions
      WHERE cron_name = 'process-dictionary'
      ORDER BY started_at DESC
      LIMIT 1
    ),
    'process_queue', (
      SELECT jsonb_build_object(
        'status', COALESCE(status, 'unknown'),
        'started_at', started_at,
        'completed_at', completed_at,
        'records_processed', records_processed,
        'signals_created', signals_created,
        'error_message', error_message
      )
      FROM cron_executions
      WHERE cron_name = 'process-queue'
      ORDER BY started_at DESC
      LIMIT 1
    ),
    'monitor', (
      SELECT jsonb_build_object(
        'status', COALESCE(status, 'unknown'),
        'started_at', started_at,
        'completed_at', completed_at,
        'error_message', error_message
      )
      FROM cron_executions
      WHERE cron_name = 'monitor'
      ORDER BY started_at DESC
      LIMIT 1
    ),
    'sync_users', (
      SELECT jsonb_build_object(
        'status', COALESCE(status, 'unknown'),
        'started_at', started_at,
        'completed_at', completed_at,
        'records_processed', records_processed,
        'error_message', error_message
      )
      FROM cron_executions
      WHERE cron_name = 'sync-users'
      ORDER BY started_at DESC
      LIMIT 1
    )
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Grant permisos
GRANT EXECUTE ON FUNCTION get_dashboard_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION get_cron_status() TO authenticated;
GRANT SELECT, INSERT, UPDATE ON cron_executions TO authenticated;
