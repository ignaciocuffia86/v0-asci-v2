-- Agregar columnas adicionales a company_news
ALTER TABLE company_news 
ADD COLUMN IF NOT EXISTS category TEXT,
ADD COLUMN IF NOT EXISTS relevance_snippet TEXT,
ADD COLUMN IF NOT EXISTS ai_provider TEXT;

-- Agregar columnas adicionales a company_implementations
ALTER TABLE company_implementations 
ADD COLUMN IF NOT EXISTS area TEXT,
ADD COLUMN IF NOT EXISTS evidence_level TEXT,
ADD COLUMN IF NOT EXISTS relevance_snippet TEXT,
ADD COLUMN IF NOT EXISTS ai_provider TEXT;

-- Comentarios para documentación
COMMENT ON COLUMN company_news.category IS 'Categoría de la noticia: corporativo|financiero|sector|regulacion|tecnologia|alianzas|reputacion';
COMMENT ON COLUMN company_news.relevance_snippet IS 'Fragmento textual de la fuente que evidencia la noticia';
COMMENT ON COLUMN company_news.ai_provider IS 'Proveedor de IA usado: perplexity|gemini';

COMMENT ON COLUMN company_implementations.area IS 'Área de implementación: finanzas|ventas|logistica|it|ciberseguridad|ecommerce';
COMMENT ON COLUMN company_implementations.evidence_level IS 'Nivel de evidencia: strong|medium|weak';
COMMENT ON COLUMN company_implementations.relevance_snippet IS 'Fragmento textual de la fuente que evidencia la implementación';
COMMENT ON COLUMN company_implementations.ai_provider IS 'Proveedor de IA usado: perplexity|gemini';
