-- =====================================================
-- MIGRATION: Nueva arquitectura de cache compartido
-- =====================================================
-- Este script:
-- 1. Crea nuevas tablas de interacciones de usuario
-- 2. Modifica company_news y company_implementations para ser cache puro
-- 3. Migra datos existentes
-- 4. Actualiza políticas RLS
-- =====================================================

-- =====================================================
-- PASO 1: Crear tablas de interacciones
-- =====================================================

-- Tabla para trackear interacciones de usuarios con noticias
CREATE TABLE IF NOT EXISTS user_news_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  news_id uuid NOT NULL REFERENCES company_news(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  viewed_at timestamp with time zone DEFAULT now(),
  notified_at timestamp with time zone, -- Cuando se envió en digest
  source text NOT NULL DEFAULT 'search', -- 'search', 'digest', 'browse'
  created_at timestamp with time zone DEFAULT now(),
  
  -- Evitar duplicados: un usuario solo puede tener una interacción por noticia
  UNIQUE(user_id, news_id)
);

-- Tabla para trackear interacciones de usuarios con implementaciones
CREATE TABLE IF NOT EXISTS user_implementation_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  implementation_id uuid NOT NULL REFERENCES company_implementations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  viewed_at timestamp with time zone DEFAULT now(),
  notified_at timestamp with time zone,
  source text NOT NULL DEFAULT 'search',
  created_at timestamp with time zone DEFAULT now(),
  
  UNIQUE(user_id, implementation_id)
);

-- Índices para búsquedas eficientes
CREATE INDEX IF NOT EXISTS idx_user_news_interactions_user_id ON user_news_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_news_interactions_company_id ON user_news_interactions(company_id);
CREATE INDEX IF NOT EXISTS idx_user_news_interactions_news_id ON user_news_interactions(news_id);
CREATE INDEX IF NOT EXISTS idx_user_news_interactions_notified ON user_news_interactions(notified_at) WHERE notified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_impl_interactions_user_id ON user_implementation_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_impl_interactions_company_id ON user_implementation_interactions(company_id);
CREATE INDEX IF NOT EXISTS idx_user_impl_interactions_impl_id ON user_implementation_interactions(implementation_id);
CREATE INDEX IF NOT EXISTS idx_user_impl_interactions_notified ON user_implementation_interactions(notified_at) WHERE notified_at IS NULL;

-- =====================================================
-- PASO 2: Migrar datos existentes a interacciones
-- =====================================================

-- Migrar interacciones de news existentes (el user_id actual se convierte en una interacción)
INSERT INTO user_news_interactions (user_id, news_id, company_id, viewed_at, source, created_at)
SELECT 
  user_id,
  id as news_id,
  company_id,
  created_at as viewed_at,
  'search' as source,
  created_at
FROM company_news
WHERE user_id IS NOT NULL
ON CONFLICT (user_id, news_id) DO NOTHING;

-- Migrar interacciones de implementations existentes
INSERT INTO user_implementation_interactions (user_id, implementation_id, company_id, viewed_at, source, created_at)
SELECT 
  user_id,
  id as implementation_id,
  company_id,
  created_at as viewed_at,
  'search' as source,
  created_at
FROM company_implementations
WHERE user_id IS NOT NULL
ON CONFLICT (user_id, implementation_id) DO NOTHING;

-- =====================================================
-- PASO 3: Limpiar duplicados en company_news y company_implementations
-- (Mantener solo el más reciente por company_id + source_url)
-- =====================================================

-- Eliminar noticias duplicadas, mantener la más reciente
DELETE FROM company_news a
USING company_news b
WHERE a.company_id = b.company_id 
  AND a.source_url = b.source_url 
  AND a.created_at < b.created_at;

-- Eliminar implementaciones duplicadas, mantener la más reciente
DELETE FROM company_implementations a
USING company_implementations b
WHERE a.company_id = b.company_id 
  AND a.source_url = b.source_url 
  AND a.created_at < b.created_at;

-- =====================================================
-- PASO 4: Modificar tablas para ser cache puro
-- (No eliminamos columnas, solo las hacemos nullable y las ignoramos)
-- =====================================================

-- Hacer nullable las columnas de usuario en company_news
ALTER TABLE company_news 
  ALTER COLUMN user_id DROP NOT NULL,
  ALTER COLUMN bookmark_id DROP NOT NULL;

-- Hacer nullable las columnas de usuario en company_implementations
ALTER TABLE company_implementations 
  ALTER COLUMN user_id DROP NOT NULL,
  ALTER COLUMN bookmark_id DROP NOT NULL;

-- Setear a NULL los user_id y bookmark_id (ya migramos las interacciones)
UPDATE company_news SET user_id = NULL, bookmark_id = NULL;
UPDATE company_implementations SET user_id = NULL, bookmark_id = NULL;

-- =====================================================
-- PASO 5: Actualizar políticas RLS
-- =====================================================

-- Eliminar políticas existentes de company_news
DROP POLICY IF EXISTS "Users can view news for their bookmarked companies" ON company_news;
DROP POLICY IF EXISTS "Users can insert their own news" ON company_news;
DROP POLICY IF EXISTS "Users can update their own news" ON company_news;
DROP POLICY IF EXISTS "Users can delete their own news" ON company_news;

-- Nuevas políticas para company_news (cache compartido)
CREATE POLICY "Anyone can view news for bookmarked companies" ON company_news
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM bookmarks 
      WHERE bookmarks.company_id = company_news.company_id 
      AND bookmarks.user_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated users can insert news" ON company_news
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update news" ON company_news
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Eliminar políticas existentes de company_implementations
DROP POLICY IF EXISTS "Users can view implementations for their bookmarked companies" ON company_implementations;
DROP POLICY IF EXISTS "Users can insert their own implementations" ON company_implementations;
DROP POLICY IF EXISTS "Users can update their own implementations" ON company_implementations;
DROP POLICY IF EXISTS "Users can delete their own implementations" ON company_implementations;

-- Nuevas políticas para company_implementations (cache compartido)
CREATE POLICY "Anyone can view implementations for bookmarked companies" ON company_implementations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM bookmarks 
      WHERE bookmarks.company_id = company_implementations.company_id 
      AND bookmarks.user_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated users can insert implementations" ON company_implementations
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update implementations" ON company_implementations
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- =====================================================
-- PASO 6: Políticas RLS para tablas de interacciones
-- =====================================================

ALTER TABLE user_news_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_implementation_interactions ENABLE ROW LEVEL SECURITY;

-- Políticas para user_news_interactions
CREATE POLICY "Users can view their own news interactions" ON user_news_interactions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own news interactions" ON user_news_interactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own news interactions" ON user_news_interactions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all news interactions" ON user_news_interactions
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- Políticas para user_implementation_interactions
CREATE POLICY "Users can view their own implementation interactions" ON user_implementation_interactions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own implementation interactions" ON user_implementation_interactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own implementation interactions" ON user_implementation_interactions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all implementation interactions" ON user_implementation_interactions
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- =====================================================
-- PASO 7: Crear índice único para evitar duplicados de cache
-- =====================================================

-- Índice único para evitar duplicados de noticias por empresa y URL
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_news_unique_source 
  ON company_news(company_id, source_url) 
  WHERE source_url IS NOT NULL;

-- Índice único para evitar duplicados de implementaciones por empresa y URL
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_impl_unique_source 
  ON company_implementations(company_id, source_url) 
  WHERE source_url IS NOT NULL;

-- =====================================================
-- VERIFICACIÓN
-- =====================================================
-- Ejecutar después de la migración para verificar:
-- SELECT COUNT(*) FROM user_news_interactions;
-- SELECT COUNT(*) FROM user_implementation_interactions;
-- SELECT COUNT(*) FROM company_news;
-- SELECT COUNT(*) FROM company_implementations;
