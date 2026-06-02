-- =====================================================
-- DIAGNÓSTICO PARTE 4: Test del RPC (con filtro de país)
-- Ejecutar después de parte 3
-- =====================================================

-- Probar RPC CON filtro de país
SELECT * FROM export_contacts(
  'process',                -- p_signal_type
  ARRAY['Sales']::TEXT[],   -- p_signals
  ARRAY['Argentina']::TEXT[], -- p_countries
  NULL,                     -- p_industries
  false,                    -- p_preview
  10                        -- p_limit
);
