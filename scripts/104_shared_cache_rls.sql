-- Script 104: Compartir cache de noticias e implementaciones entre usuarios
-- Permite que usuarios con bookmarks de la misma compañía compartan el cache

-- =====================================================
-- COMPANY_NEWS: Actualizar política de SELECT
-- =====================================================

-- Eliminar política actual de SELECT
DROP POLICY IF EXISTS "Users can view their own news" ON company_news;

-- Nueva política: permite leer si el usuario tiene un bookmark de esa compañía
CREATE POLICY "Users can view news for their bookmarked companies"
ON company_news
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM bookmarks b
    WHERE b.company_id = company_news.company_id
    AND b.user_id = auth.uid()
  )
);

-- =====================================================
-- COMPANY_IMPLEMENTATIONS: Actualizar política de SELECT
-- =====================================================

-- Eliminar política actual de SELECT
DROP POLICY IF EXISTS "Users can view their own implementations" ON company_implementations;

-- Nueva política: permite leer si el usuario tiene un bookmark de esa compañía
CREATE POLICY "Users can view implementations for their bookmarked companies"
ON company_implementations
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM bookmarks b
    WHERE b.company_id = company_implementations.company_id
    AND b.user_id = auth.uid()
  )
);

-- =====================================================
-- Verificación
-- =====================================================
-- Las políticas de INSERT, UPDATE, DELETE siguen siendo restrictivas al user_id
-- Solo SELECT es compartido entre usuarios con bookmarks de la misma compañía
