-- =============================================
-- Apollo Prospects System
-- =============================================

-- 1. Cache global de contactos de Apollo (para evitar pagar 2 veces por el mismo contacto)
CREATE TABLE IF NOT EXISTS public.apollo_contacts_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  apollo_id TEXT UNIQUE,                    -- ID único de Apollo para evitar duplicados
  company_domain TEXT,                      -- Dominio de la compañía buscada
  company_linkedin_url TEXT,                -- LinkedIn URL de la compañía
  
  -- Datos del contacto
  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  title TEXT,                               -- Job title de Apollo
  headline TEXT,
  email TEXT,
  email_status TEXT,                        -- 'verified', 'unverified', 'guessed', etc.
  phone TEXT,
  mobile_phone TEXT,
  linkedin_url TEXT,
  profile_picture_url TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  
  -- Datos de la organización de Apollo
  organization_name TEXT,
  organization_website TEXT,
  organization_linkedin_url TEXT,
  organization_industry TEXT,
  
  -- Datos adicionales de Apollo
  seniority TEXT,                           -- 'c_suite', 'vp', 'director', 'manager', etc.
  departments JSONB,                        -- Array de departamentos
  employment_history JSONB,                 -- Historial laboral si disponible
  
  -- Metadata de búsqueda
  job_titles_searched TEXT[],               -- Job titles usados en la búsqueda original
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para búsqueda eficiente en cache
CREATE INDEX IF NOT EXISTS idx_apollo_cache_domain ON public.apollo_contacts_cache(company_domain);
CREATE INDEX IF NOT EXISTS idx_apollo_cache_linkedin ON public.apollo_contacts_cache(company_linkedin_url);
CREATE INDEX IF NOT EXISTS idx_apollo_cache_apollo_id ON public.apollo_contacts_cache(apollo_id);

-- RLS: Todos los usuarios autenticados pueden leer el cache
ALTER TABLE public.apollo_contacts_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read apollo cache" ON public.apollo_contacts_cache
  FOR SELECT USING (auth.role() = 'authenticated');

-- Solo service role puede insertar/actualizar (vía API)
CREATE POLICY "Service role can manage apollo cache" ON public.apollo_contacts_cache
  FOR ALL USING (auth.role() = 'service_role');


-- 2. Modificar user_company_contacts para agregar campos de Apollo
ALTER TABLE public.user_company_contacts 
  ADD COLUMN IF NOT EXISTS apollo_cache_id UUID REFERENCES public.apollo_contacts_cache(id),
  ADD COLUMN IF NOT EXISTS headline TEXT,
  ADD COLUMN IF NOT EXISTS profile_picture_url TEXT,
  ADD COLUMN IF NOT EXISTS email_status TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS mobile_phone TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS seniority TEXT,
  ADD COLUMN IF NOT EXISTS departments JSONB,
  ADD COLUMN IF NOT EXISTS is_decision_maker BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS job_titles_searched TEXT[],
  ADD COLUMN IF NOT EXISTS search_context JSONB;

-- Índice para buscar decision makers rápidamente
CREATE INDEX IF NOT EXISTS idx_user_contacts_dm ON public.user_company_contacts(user_id, company_id, is_decision_maker) 
  WHERE is_decision_maker = true;


-- 3. Función para obtener prospectos (DMs) para icebreakers
CREATE OR REPLACE FUNCTION get_prospects_for_icebreakers(
  p_bookmark_id UUID,
  p_user_id UUID
)
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  first_name TEXT,
  role TEXT,
  headline TEXT,
  linkedin_url TEXT,
  email TEXT,
  email_status TEXT,
  phone TEXT,
  profile_picture_url TEXT,
  source TEXT,
  is_decision_maker BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ucc.id,
    ucc.full_name,
    ucc.first_name,
    ucc.role,
    ucc.headline,
    ucc.linkedin_url,
    ucc.email,
    ucc.email_status,
    COALESCE(ucc.mobile_phone, ucc.phone) as phone,
    ucc.profile_picture_url,
    ucc.source,
    ucc.is_decision_maker
  FROM public.user_company_contacts ucc
  WHERE ucc.bookmark_id = p_bookmark_id
    AND ucc.user_id = p_user_id
    AND ucc.is_decision_maker = true
  ORDER BY ucc.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
