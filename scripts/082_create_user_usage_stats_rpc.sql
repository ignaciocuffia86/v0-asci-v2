-- RPC para obtener estadísticas de uso por usuario
-- Ejecutar después de 081

-- Drop function first to avoid conflicts
DROP FUNCTION IF EXISTS public.get_user_usage_stats();

-- Agregar search_path para acceder a auth schema y simplificar query
CREATE OR REPLACE FUNCTION public.get_user_usage_stats()
RETURNS TABLE (
  user_id UUID,
  user_email TEXT,
  total_bookmarks BIGINT,
  high_priority BIGINT,
  medium_priority BIGINT,
  low_priority BIGINT,
  no_priority BIGINT
) 
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT 
    b.user_id,
    COALESCE(u.email::TEXT, 'Sin email'::TEXT) as user_email,
    COUNT(b.id)::BIGINT as total_bookmarks,
    COUNT(CASE WHEN b.priority = 'alta' THEN 1 END)::BIGINT as high_priority,
    COUNT(CASE WHEN b.priority = 'media' THEN 1 END)::BIGINT as medium_priority,
    COUNT(CASE WHEN b.priority = 'baja' THEN 1 END)::BIGINT as low_priority,
    COUNT(CASE WHEN b.priority IS NULL OR b.priority NOT IN ('alta', 'media', 'baja') THEN 1 END)::BIGINT as no_priority
  FROM bookmarks b
  LEFT JOIN auth.users u ON u.id = b.user_id
  GROUP BY b.user_id, u.email
  ORDER BY COUNT(b.id) DESC;
$$;

-- Dar permisos
GRANT EXECUTE ON FUNCTION public.get_user_usage_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_usage_stats() TO service_role;
