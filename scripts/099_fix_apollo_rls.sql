-- =============================================
-- Fix Apollo Contacts Cache RLS Policies
-- =============================================

-- Drop existing policies
DROP POLICY IF EXISTS "Authenticated users can read apollo cache" ON public.apollo_contacts_cache;
DROP POLICY IF EXISTS "Service role can manage apollo cache" ON public.apollo_contacts_cache;

-- Create new policies that allow authenticated users to manage the cache
-- Read: todos los usuarios autenticados pueden leer
CREATE POLICY "Authenticated users can read apollo cache" ON public.apollo_contacts_cache
  FOR SELECT TO authenticated
  USING (true);

-- Insert: usuarios autenticados pueden insertar nuevos contactos al cache
CREATE POLICY "Authenticated users can insert apollo cache" ON public.apollo_contacts_cache
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Update: usuarios autenticados pueden actualizar (para el upsert)
CREATE POLICY "Authenticated users can update apollo cache" ON public.apollo_contacts_cache
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- Nota: No permitimos DELETE a usuarios normales, solo service_role
CREATE POLICY "Service role can delete apollo cache" ON public.apollo_contacts_cache
  FOR DELETE TO service_role
  USING (true);
