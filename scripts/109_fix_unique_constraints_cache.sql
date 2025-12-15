-- Eliminar índices previos si existen (del script 108)
DROP INDEX IF EXISTS idx_company_news_unique;
DROP INDEX IF EXISTS idx_company_implementations_unique;

-- Crear índices únicos en (company_id, source_url) para evitar duplicados
-- Usamos source_url porque es más confiable que title (puede haber títulos similares)
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_news_unique_source 
ON company_news(company_id, source_url);

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_implementations_unique_source 
ON company_implementations(company_id, source_url);

-- Nota: Este índice permite hacer upsert con onConflict: "company_id,source_url"
