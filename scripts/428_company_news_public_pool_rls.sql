-- 428: `public.company_news` como pool público por compañía.
--
-- CONTEXTO
-- El esquema y el path del MCP ya tratan a las noticias como un bien común por compañía:
-- la fila no tiene `workspace_id` de alcance (pertenece a la compañía), `sourced_by_workspace`
-- solo ATRIBUYE quién la aportó, y los lectores del MCP (`scoring.ts`,
-- `prepare-brief-context.ts`) filtran únicamente por `company_id`. Pero la RLS de la web
-- contradecía ese diseño y nadie lo notaba, porque el MCP usa service role y saltea RLS.
--
-- OJO: `company_news` la comparte v2 en producción. Los dos cambios de acá son seguros
-- porque AMPLÍAN la lectura (nadie pierde acceso) y porque **no existe un solo `.update()`
-- a `company_news` en todo el repo** (relevado con grep): la política de UPDATE que se
-- endurece hoy no la usa ninguna ruta ni componente.
--
-- SIN `BEGIN`/`COMMIT`: `run-sql.mjs` ya envuelve el archivo en su transacción y un COMMIT
-- explícito anula el dry run (queda persistido mientras informa que no guardó nada).

-- ---------------------------------------------------------------------------
-- 1. LECTURA: de bookmark personal de v2 → pool público por compañía
-- ---------------------------------------------------------------------------
-- La política vieja exigía una fila en `bookmarks` con `user_id = auth.uid()`. `bookmarks`
-- es un concepto POR USUARIO de v2, así que un miembro de un workspace de v3 que sigue una
-- cuenta pero no la bookmarkeó no veía NINGUNA noticia, y lo que aportaba un usuario no le
-- llegaba a otro: lo contrario a un pool retroalimentado.
DROP POLICY IF EXISTS "Anyone can view news for bookmarked companies" ON public.company_news;

CREATE POLICY "Authenticated users can view all news"
  ON public.company_news
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 2. ESCRITURA: cerrar el envenenamiento cross-tenant del scoring
-- ---------------------------------------------------------------------------
-- La política vieja era `USING (auth.uid() IS NOT NULL)` y **sin `WITH CHECK`**: cualquier
-- autenticado podía editar cualquier fila de cualquier compañía, incluidos `direction` y
-- `evidence_level`, que `scoring.ts` usa para la señal de timing de TODOS los tenants.
-- Ahora solo puede editar quien aportó la nota (o un superadmin), y el `WITH CHECK` que
-- faltaba impide además reatribuir una fila a otro workspace.
--
-- Nota: las 1100 filas heredadas de v2 tienen `sourced_by_workspace` NULL, así que quedan
-- editables solo por superadmin. Es el default seguro y no rompe nada, justamente porque
-- ningún flujo de la app actualiza esta tabla.
DROP POLICY IF EXISTS "Authenticated users can update news" ON public.company_news;

CREATE POLICY "Contributors and superadmins can update news"
  ON public.company_news
  FOR UPDATE
  USING (
    public.is_superadmin()
    OR (
      sourced_by_workspace IS NOT NULL
      AND sourced_by_workspace = v3.user_workspace_id(auth.uid())
    )
  )
  WITH CHECK (
    public.is_superadmin()
    OR (
      sourced_by_workspace IS NOT NULL
      AND sourced_by_workspace = v3.user_workspace_id(auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
DO $$
DECLARE n_select int; n_update int; n_vieja int;
BEGIN
  SELECT count(*) INTO n_select FROM pg_policies
   WHERE schemaname='public' AND tablename='company_news'
     AND cmd='SELECT' AND policyname='Authenticated users can view all news';
  SELECT count(*) INTO n_update FROM pg_policies
   WHERE schemaname='public' AND tablename='company_news'
     AND cmd='UPDATE' AND with_check IS NOT NULL;
  SELECT count(*) INTO n_vieja FROM pg_policies
   WHERE schemaname='public' AND tablename='company_news'
     AND policyname IN ('Anyone can view news for bookmarked companies','Authenticated users can update news');

  IF n_select <> 1 OR n_update <> 1 OR n_vieja <> 0 THEN
    RAISE EXCEPTION 'RLS mal aplicada: select=% update_con_check=% viejas=%', n_select, n_update, n_vieja;
  END IF;
  RAISE NOTICE 'OK: lectura publica por compania + update restringido con WITH CHECK';
END $$;
