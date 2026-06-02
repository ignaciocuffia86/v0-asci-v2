-- =====================================================
-- DIAGNÓSTICO PARTE 3: Test del RPC (sin filtro de país)
-- Ejecutar después de parte 2
-- =====================================================

-- Probar RPC sin filtro de país, solo con un signal_type
SELECT * FROM export_contacts(
  'process',           -- p_signal_type
  ARRAY['Sales']::TEXT[],  -- p_signals (usar un proceso que exista)
  NULL,                -- p_countries (sin filtro)
  NULL,                -- p_industries
  false,               -- p_preview
  10                   -- p_limit
);
