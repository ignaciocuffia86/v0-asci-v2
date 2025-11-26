-- =====================================================
-- Script 079: Crear tablas para contexto de Icebreakers
-- =====================================================
-- Tablas: company_news, success_cases, company_implementations
-- Todas con RLS por usuario para aislamiento de datos

-- =====================================================
-- 1. TABLA: company_news (Noticias por usuario/bookmark)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.company_news (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bookmark_id UUID NOT NULL REFERENCES public.bookmarks(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  
  -- Contenido de la noticia
  title TEXT NOT NULL,
  summary TEXT, -- Resumen corto para mostrar en RSS
  source_url TEXT, -- Link a la noticia original
  source_name TEXT, -- Nombre del medio (ej: "LinkedIn", "Clarín", "Infobae")
  published_at TIMESTAMPTZ, -- Fecha de publicación de la noticia
  
  -- Relevancia para icebreaker
  relevance_tags TEXT[], -- Tags como: "expansion", "new_product", "partnership", "hiring"
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para company_news
CREATE INDEX IF NOT EXISTS idx_company_news_user_id ON public.company_news(user_id);
CREATE INDEX IF NOT EXISTS idx_company_news_bookmark_id ON public.company_news(bookmark_id);
CREATE INDEX IF NOT EXISTS idx_company_news_company_id ON public.company_news(company_id);

-- RLS para company_news
ALTER TABLE public.company_news ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own news" ON public.company_news;
CREATE POLICY "Users can view their own news" ON public.company_news
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own news" ON public.company_news;
CREATE POLICY "Users can insert their own news" ON public.company_news
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own news" ON public.company_news;
CREATE POLICY "Users can update their own news" ON public.company_news
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own news" ON public.company_news;
CREATE POLICY "Users can delete their own news" ON public.company_news
  FOR DELETE USING (auth.uid() = user_id);

-- =====================================================
-- 2. TABLA: success_cases (Casos de Éxito del usuario)
-- =====================================================
-- Nota: Los casos de éxito son GLOBALES del usuario (su portfolio)
-- No están atados a un bookmark específico, pero pueden filtrarse por industria
CREATE TABLE IF NOT EXISTS public.success_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Información del caso
  title TEXT NOT NULL, -- Título del caso (ej: "Migración a SAP S/4HANA")
  client_industry TEXT, -- Industria del cliente (ej: "Manufactura", "Banca")
  client_size TEXT, -- Tamaño (ej: "Enterprise", "Mid-Market", "SMB")
  
  -- Contenido del caso
  challenge TEXT, -- Problema/desafío que tenía el cliente
  solution TEXT, -- Solución implementada
  results TEXT, -- Resultados obtenidos
  technologies TEXT[], -- Tecnologías utilizadas (ej: ["SAP", "S4HANA", "Fiori"])
  
  -- Links y referencias
  case_url TEXT, -- Link al caso completo (si existe)
  
  -- Metadata
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para success_cases
CREATE INDEX IF NOT EXISTS idx_success_cases_user_id ON public.success_cases(user_id);
CREATE INDEX IF NOT EXISTS idx_success_cases_industry ON public.success_cases(client_industry);
CREATE INDEX IF NOT EXISTS idx_success_cases_technologies ON public.success_cases USING GIN(technologies);

-- RLS para success_cases
ALTER TABLE public.success_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own cases" ON public.success_cases;
CREATE POLICY "Users can view their own cases" ON public.success_cases
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own cases" ON public.success_cases;
CREATE POLICY "Users can insert their own cases" ON public.success_cases
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own cases" ON public.success_cases;
CREATE POLICY "Users can update their own cases" ON public.success_cases
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own cases" ON public.success_cases;
CREATE POLICY "Users can delete their own cases" ON public.success_cases
  FOR DELETE USING (auth.uid() = user_id);

-- =====================================================
-- 3. TABLA: company_implementations (NUEVO)
-- Casos donde la empresa del bookmark es CLIENTE de implementaciones
-- =====================================================
CREATE TABLE IF NOT EXISTS public.company_implementations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bookmark_id UUID NOT NULL REFERENCES public.bookmarks(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  
  -- Información del caso
  title TEXT NOT NULL, -- Título: "Migración a SAP S4HANA"
  provider_name TEXT, -- Quién implementó: "Accenture", "IBM", "Deloitte"
  technology TEXT, -- Tecnología implementada: "SAP S4HANA", "Oracle Cloud"
  
  -- Contenido
  summary TEXT, -- Resumen del proyecto
  results TEXT, -- Resultados obtenidos: "40% reducción en tiempos de cierre"
  
  -- Fuente
  source_url TEXT, -- Link a la noticia/caso de estudio
  source_name TEXT, -- Nombre de la fuente: "SAP News", "LinkedIn", "CIO Magazine"
  published_at TIMESTAMPTZ, -- Fecha de publicación
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para company_implementations
CREATE INDEX IF NOT EXISTS idx_company_implementations_user_id ON public.company_implementations(user_id);
CREATE INDEX IF NOT EXISTS idx_company_implementations_bookmark_id ON public.company_implementations(bookmark_id);
CREATE INDEX IF NOT EXISTS idx_company_implementations_company_id ON public.company_implementations(company_id);

-- RLS para company_implementations
ALTER TABLE public.company_implementations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own implementations" ON public.company_implementations;
CREATE POLICY "Users can view their own implementations" ON public.company_implementations
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own implementations" ON public.company_implementations;
CREATE POLICY "Users can insert their own implementations" ON public.company_implementations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own implementations" ON public.company_implementations;
CREATE POLICY "Users can update their own implementations" ON public.company_implementations
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own implementations" ON public.company_implementations;
CREATE POLICY "Users can delete their own implementations" ON public.company_implementations
  FOR DELETE USING (auth.uid() = user_id);

-- =====================================================
-- 4. TRIGGER para updated_at
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_company_news_updated_at ON public.company_news;
CREATE TRIGGER update_company_news_updated_at
    BEFORE UPDATE ON public.company_news
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_success_cases_updated_at ON public.success_cases;
CREATE TRIGGER update_success_cases_updated_at
    BEFORE UPDATE ON public.success_cases
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_company_implementations_updated_at ON public.company_implementations;
CREATE TRIGGER update_company_implementations_updated_at
    BEFORE UPDATE ON public.company_implementations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 5. Verificación
-- =====================================================
SELECT 'Tablas creadas correctamente' as resultado,
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'company_news') as company_news_exists,
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'success_cases') as success_cases_exists,
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'company_implementations') as company_implementations_exists;
