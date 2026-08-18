-- =============================================================================
-- Deja explícito el invariante de atribución del cache compartido
--
-- `sourced_by_workspace` marca QUIÉN TRAJO el dato, no quién puede leerlo. La
-- evidencia se paga una vez y la aprovechan todos: si un workspace investiga una
-- compañía, cualquier usuario que la tenga en bookmarks ve esas noticias y recibe
-- la notificación correspondiente.
--
-- Estado verificado al 2026-08-18 (ninguna policy de SELECT mira la columna):
--   company_news         SELECT → auth.uid() IS NOT NULL          (abierto a todo autenticado)
--   company_news         UPDATE → sourced_by_workspace = el propio, o superadmin
--   company_implementations SELECT → sólo compañías que el usuario tiene en bookmarks
--   company_implementations UPDATE → auth.uid() IS NOT NULL
--
-- O sea: la atribución gobierna la ESCRITURA (quién puede corregir lo que trajo)
-- y la auditoría (poder revertir en bloque si el contenido de un workspace
-- resultara malo), nunca la lectura.
--
-- Sólo comentarios: no cambia policies ni datos.
-- =============================================================================

comment on column public.company_news.sourced_by_workspace is
  'Workspace que TRAJO la noticia. Es atribución y control de escritura, NUNCA un filtro de lectura: el cache es compartido y cualquier usuario autenticado lee todas las noticias. No usar esta columna en policies de SELECT.';

comment on column public.company_implementations.sourced_by_workspace is
  'Workspace que TRAJO el caso. Es atribución, NUNCA un filtro de lectura: el cache es compartido. La visibilidad la gobierna el bookmark de la compañía, no el workspace de origen. No usar esta columna en policies de SELECT.';

comment on column public.radar_findings.sourced_by_workspace is
  'Workspace que TRAJO el hallazgo. Atribución solamente. La tabla se lee vía service_role o vía RPC security definer.';

comment on column public.job_postings.sourced_by_workspace is
  'Workspace que disparó el scraping. Atribución solamente: las vacantes son cache compartido por compañía.';
