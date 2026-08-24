-- ═══════════════════════════════════════════════════════════════════
-- Fusión reversible de contactos duplicados
--
-- La migración anterior deja de CREAR duplicados. Esta fusiona los que ya
-- están. Dry run sobre producción, con el tope de identidad compartida en 5:
--
--     email 2.857 grupos   phone 477   slug 126   suffix 106
--     3.566 grupos, 3.577 fusiones, 4.266 filas de `contacts` distintas.
--
-- Sin el tope, la regla del teléfono sube a 2.427 grupos, pero muchos salen de
-- conmutadores: 1.676 números están en más de 20 contactos y hay uno en 4.941.
--
-- Es el gemelo de merge_companies() / v3.company_merges, con las mismas
-- garantías: snapshot de la fila que desaparece, registro de qué se movió,
-- dry_run, y reversión. Un merge que no se puede deshacer no se ejecuta en
-- masa sobre 4.266 filas.
--
-- La diferencia con empresas es que contacts tiene solo dos hijos por FK
-- (signals y pending_signals, ambos ON DELETE CASCADE) y tres referencias
-- sueltas SIN FK que un borrado no arrastra y hay que mover a mano:
-- user_icebreakers.contact_id, v3.client_ai_executions.contact_id y
-- v3.campaign_account_digest.contact_ids (array). Ese es justamente el motivo
-- de no reusar merge_companies(), que descubre hijos por catálogo de FKs y
-- no vería ninguna de las tres.
--
-- Esta migración NO fusiona nada por sí sola: instala la maquinaria. La corrida
-- se hace con auto_merge_contact_duplicates(), en lotes y a pedido.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists v3.contact_merges (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null,
  duplicate_id uuid not null,
  duplicate_snapshot jsonb not null,
  moved jsonb not null default '{}'::jsonb,
  deleted jsonb not null default '{}'::jsonb,
  rule text not null,
  confidence numeric,
  reasoning text,
  decided_by uuid,
  created_at timestamptz not null default now(),
  reverted_at timestamptz
);

comment on table v3.contact_merges is
  'Historial de fusiones de contactos. `duplicate_snapshot` y `moved` alcanzan para deshacer una fusión: sin eso no se puede correr en masa.';

create index if not exists idx_contact_merges_master on v3.contact_merges (master_id);
create index if not exists idx_contact_merges_pendientes on v3.contact_merges (created_at desc) where reverted_at is null;

-- ───────────────────────────────────────────────────────────────────
-- merge_contacts
-- ───────────────────────────────────────────────────────────────────

create or replace function public.merge_contacts(
  p_master_id uuid,
  p_duplicate_id uuid,
  p_dry_run boolean default false,
  p_rule text default 'manual',
  p_confidence numeric default null,
  p_reasoning text default null,
  p_decided_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'v3', 'pg_catalog'
as $function$
DECLARE
  v_snapshot JSONB;
  v_moved    JSONB := '{}'::jsonb;
  v_deleted  JSONB := '{}'::jsonb;
  v_ids      JSONB;
  v_master   JSONB;
  v_fresco   JSONB;
  v_viejo    JSONB;
  v_lista_fresco JSONB;
  v_lista_viejo  JSONB;
  v_merge_id UUID;
  v_result   JSONB;
BEGIN
  IF p_master_id IS NULL OR p_duplicate_id IS NULL THEN
    RAISE EXCEPTION 'merge_contacts: los ids no pueden ser NULL';
  END IF;
  IF p_master_id = p_duplicate_id THEN
    RAISE EXCEPTION 'merge_contacts: master y duplicado son la misma fila (%)', p_master_id;
  END IF;

  SELECT to_jsonb(c) INTO v_snapshot FROM public.contacts c WHERE c.id = p_duplicate_id;
  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'merge_contacts: no existe el contacto duplicado %', p_duplicate_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = p_master_id) THEN
    RAISE EXCEPTION 'merge_contacts: no existe el contacto master %', p_master_id;
  END IF;

  BEGIN
    -- ── signals ──
    -- Hay UNIQUE (signal_id, contact_id, company_id): si el master ya tiene esa
    -- misma señal, la del duplicado no se puede mover y se borra. No se pierde
    -- evidencia: es literalmente la misma (empresa, entrada de diccionario)
    -- que la UI ya venía plegando como una sola.
    WITH movibles AS (
      SELECT s.id FROM public.signals s
      WHERE s.contact_id = p_duplicate_id
        AND NOT EXISTS (
          SELECT 1 FROM public.signals m
          WHERE m.contact_id = p_master_id
            AND m.signal_id IS NOT DISTINCT FROM s.signal_id
            AND m.signal_type IS NOT DISTINCT FROM s.signal_type
            AND m.company_id IS NOT DISTINCT FROM s.company_id
        )
    ), movidas AS (
      UPDATE public.signals s SET contact_id = p_master_id
      WHERE s.id IN (SELECT id FROM movibles)
      RETURNING s.id
    )
    SELECT coalesce(jsonb_agg(id), '[]'::jsonb) INTO v_ids FROM movidas;
    v_moved := v_moved || jsonb_build_object('signals', v_ids);

    WITH borradas AS (
      DELETE FROM public.signals s WHERE s.contact_id = p_duplicate_id RETURNING s.id
    )
    SELECT coalesce(jsonb_agg(id), '[]'::jsonb) INTO v_ids FROM borradas;
    v_deleted := v_deleted || jsonb_build_object('signals', v_ids);

    -- ── pending_signals ──
    WITH movidas AS (
      UPDATE public.pending_signals ps SET contact_id = p_master_id
      WHERE ps.contact_id = p_duplicate_id RETURNING ps.id
    )
    SELECT coalesce(jsonb_agg(id), '[]'::jsonb) INTO v_ids FROM movidas;
    v_moved := v_moved || jsonb_build_object('pending_signals', v_ids);

    -- ── referencias sueltas, sin FK: un DELETE del contacto las dejaría
    --    apuntando a un id inexistente ──
    WITH movidas AS (
      UPDATE public.user_icebreakers ui SET contact_id = p_master_id
      WHERE ui.contact_id = p_duplicate_id RETURNING ui.id
    )
    SELECT coalesce(jsonb_agg(id), '[]'::jsonb) INTO v_ids FROM movidas;
    v_moved := v_moved || jsonb_build_object('user_icebreakers', v_ids);

    -- contact_id acá es TEXT, no uuid.
    WITH movidas AS (
      UPDATE v3.client_ai_executions e SET contact_id = p_master_id::text
      WHERE e.contact_id = p_duplicate_id::text RETURNING e.id
    )
    SELECT coalesce(jsonb_agg(id), '[]'::jsonb) INTO v_ids FROM movidas;
    v_moved := v_moved || jsonb_build_object('client_ai_executions', v_ids);

    WITH movidas AS (
      UPDATE v3.campaign_account_digest d
         SET contact_ids = (
           SELECT array_agg(DISTINCT CASE WHEN x = p_duplicate_id THEN p_master_id ELSE x END)
           FROM unnest(d.contact_ids) x
         )
      WHERE d.contact_ids @> ARRAY[p_duplicate_id] RETURNING d.id
    )
    SELECT coalesce(jsonb_agg(id), '[]'::jsonb) INTO v_ids FROM movidas;
    v_moved := v_moved || jsonb_build_object('campaign_account_digest', v_ids);

    -- ── identidades: el duplicado se lleva sus slugs, emails y teléfonos al
    --    master. Es lo que hace que el próximo export con la URL vieja resuelva
    --    al master en vez de recrear la fila que estamos borrando. ──
    INSERT INTO public.contact_identities (contact_id, kind, value, first_seen_at)
    SELECT p_master_id, ci.kind, ci.value, ci.first_seen_at
    FROM public.contact_identities ci
    WHERE ci.contact_id = p_duplicate_id
    ON CONFLICT DO NOTHING;

    -- ── Qué fila sobrevive y con qué contenido ──
    --
    -- Son dos decisiones distintas y hay que separarlas:
    --
    --   El ID que sobrevive es el que tiene la evidencia colgada (pick_contact_master
    --   elige por cantidad de señales). Mover señales es caro y hay bookmarks e
    --   icebreakers apuntando ahí.
    --
    --   El CONTENIDO del perfil, en cambio, tiene que ser el del scrapeo más
    --   fresco, sin importar en cuál de las dos filas esté. Medido sobre los
    --   2.470 pares de la base: el cargo difiere en el 65%, el headline en el
    --   60% y la empresa actual en el 23% —la persona cambió de trabajo—, y en
    --   701 pares las señales están del lado de la fila VIEJA. Quedarse con los
    --   valores del master sería mostrar el cargo de hace un año en 1 de cada 4
    --   fusiones.
    --
    -- Por eso: el perfil vigente pisa, el viejo solo rellena huecos. Es un
    -- reemplazo de contenido dentro del ID que conserva la evidencia.
    SELECT to_jsonb(c) INTO v_master FROM public.contacts c WHERE c.id = p_master_id;

    IF (v_snapshot->>'updated_at')::timestamptz > (v_master->>'updated_at')::timestamptz THEN
      v_fresco := v_snapshot; v_viejo := v_master;
    ELSE
      v_fresco := v_master; v_viejo := v_snapshot;
    END IF;

    v_lista_fresco := CASE WHEN jsonb_typeof(v_fresco->'previous_positions') = 'array'
                           THEN v_fresco->'previous_positions' ELSE '[]'::jsonb END;
    v_lista_viejo  := CASE WHEN jsonb_typeof(v_viejo->'previous_positions') = 'array'
                           THEN v_viejo->'previous_positions' ELSE '[]'::jsonb END;

    -- El DELETE va ANTES del UPDATE: linkedin_url es UNIQUE y el master puede
    -- quedarse con la URL del duplicado, que hasta que no se borre está ocupada.
    DELETE FROM public.contacts WHERE id = p_duplicate_id;

    UPDATE public.contacts m SET
      linkedin_url                = coalesce(v_fresco->>'linkedin_url',                 v_viejo->>'linkedin_url'),
      full_name                   = coalesce(v_fresco->>'full_name',                    v_viejo->>'full_name'),
      first_name                  = coalesce(v_fresco->>'first_name',                   v_viejo->>'first_name'),
      last_name                   = coalesce(v_fresco->>'last_name',                    v_viejo->>'last_name'),
      headline                    = coalesce(v_fresco->>'headline',                     v_viejo->>'headline'),
      about                       = coalesce(v_fresco->>'about',                        v_viejo->>'about'),
      profile_picture_url         = coalesce(v_fresco->>'profile_picture_url',          v_viejo->>'profile_picture_url'),
      current_position_title      = coalesce(v_fresco->>'current_position_title',       v_viejo->>'current_position_title'),
      current_position_description= coalesce(v_fresco->>'current_position_description', v_viejo->>'current_position_description'),
      current_position_started_on = coalesce((v_fresco->>'current_position_started_on')::date, (v_viejo->>'current_position_started_on')::date),
      current_company_id          = coalesce((v_fresco->>'current_company_id')::uuid,   (v_viejo->>'current_company_id')::uuid),
      country                     = coalesce(nullif(v_fresco->>'country', ''),          nullif(v_viejo->>'country', '')),
      -- Mails y teléfonos se ACUMULAN: el fresco tiene prioridad de posición,
      -- pero lo que solo estaba en el viejo no se tira. En 53 pares el dato de
      -- contacto está únicamente en la fila vieja.
      email1        = coalesce(v_fresco->>'email1',        v_viejo->>'email1'),
      email1_type   = coalesce(v_fresco->>'email1_type',   v_viejo->>'email1_type'),
      email1_status = coalesce(v_fresco->>'email1_status', v_viejo->>'email1_status'),
      email2        = coalesce(v_fresco->>'email2',        v_viejo->>'email2'),
      email2_type   = coalesce(v_fresco->>'email2_type',   v_viejo->>'email2_type'),
      email2_status = coalesce(v_fresco->>'email2_status', v_viejo->>'email2_status'),
      email3        = coalesce(v_fresco->>'email3',        v_viejo->>'email3'),
      email3_type   = coalesce(v_fresco->>'email3_type',   v_viejo->>'email3_type'),
      email3_status = coalesce(v_fresco->>'email3_status', v_viejo->>'email3_status'),
      email4        = coalesce(v_fresco->>'email4',        v_viejo->>'email4'),
      email4_type   = coalesce(v_fresco->>'email4_type',   v_viejo->>'email4_type'),
      email4_status = coalesce(v_fresco->>'email4_status', v_viejo->>'email4_status'),
      phone1        = coalesce(v_fresco->>'phone1',        v_viejo->>'phone1'),
      phone1_type   = coalesce(v_fresco->>'phone1_type',   v_viejo->>'phone1_type'),
      phone2        = coalesce(v_fresco->>'phone2',        v_viejo->>'phone2'),
      phone2_type   = coalesce(v_fresco->>'phone2_type',   v_viejo->>'phone2_type'),
      -- Historial: gana el MÁS LARGO, no el más fresco. En 733 pares el scrapeo
      -- nuevo trajo menos puestos previos que el viejo; pisar sería perderlos.
      --
      -- El typeof no es defensa de más: la columna guarda el JSON `null` (no
      -- SQL NULL) cuando el perfil no tenía puestos previos, y coalesce() no lo
      -- atrapa — jsonb_array_length() sobre eso revienta la fusión entera.
      previous_positions = CASE
        WHEN jsonb_array_length(v_lista_viejo) > jsonb_array_length(v_lista_fresco)
        THEN v_lista_viejo ELSE v_lista_fresco END,
      updated_at = timezone('utc'::text, now())
    WHERE m.id = p_master_id;

    INSERT INTO v3.contact_merges (
      master_id, duplicate_id, duplicate_snapshot, moved, deleted,
      rule, confidence, reasoning, decided_by
    ) VALUES (
      p_master_id, p_duplicate_id, v_snapshot, v_moved, v_deleted,
      p_rule, p_confidence, p_reasoning, p_decided_by
    ) RETURNING id INTO v_merge_id;

    v_result := jsonb_build_object(
      'dry_run', p_dry_run,
      'merge_id', v_merge_id,
      'master_id', p_master_id,
      'duplicate_id', p_duplicate_id,
      'duplicate_name', v_snapshot->>'full_name',
      'perfil_vigente', CASE WHEN v_fresco = v_snapshot THEN 'el duplicado' ELSE 'el master' END,
      'moved', v_moved,
      'deleted', v_deleted,
      'moved_total', (SELECT coalesce(sum(jsonb_array_length(value)), 0) FROM jsonb_each(v_moved)),
      'deleted_total', (SELECT coalesce(sum(jsonb_array_length(value)), 0) FROM jsonb_each(v_deleted))
    );

    IF p_dry_run THEN
      RAISE EXCEPTION 'dry run' USING ERRCODE = 'YY001';
    END IF;

  EXCEPTION WHEN SQLSTATE 'YY001' THEN
    v_result := v_result || jsonb_build_object('merge_id', NULL, 'applied', false);
  END;

  RETURN coalesce(v_result, '{}'::jsonb) || jsonb_build_object('applied', NOT p_dry_run);
END;
$function$;

-- ───────────────────────────────────────────────────────────────────
-- revert_contact_merge
-- ───────────────────────────────────────────────────────────────────

-- Devuelve la fila borrada con su id original y le reasigna lo que se movió.
-- Lo que se BORRÓ (señales que el master ya tenía) no vuelve: era duplicado
-- exacto y el master lo tiene. Se informa en el resultado para que quede claro.
create or replace function public.revert_contact_merge(p_merge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'v3', 'pg_catalog'
as $function$
DECLARE
  v_log v3.contact_merges;
  v_ids UUID[];
BEGIN
  SELECT * INTO v_log FROM v3.contact_merges WHERE id = p_merge_id;
  IF v_log IS NULL THEN
    RAISE EXCEPTION 'revert_contact_merge: no existe el merge %', p_merge_id;
  END IF;
  IF v_log.reverted_at IS NOT NULL THEN
    RAISE EXCEPTION 'revert_contact_merge: el merge % ya fue revertido', p_merge_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.contacts WHERE id = v_log.duplicate_id) THEN
    RAISE EXCEPTION 'revert_contact_merge: el contacto % ya existe', v_log.duplicate_id;
  END IF;

  INSERT INTO public.contacts SELECT * FROM jsonb_populate_record(NULL::public.contacts, v_log.duplicate_snapshot);

  SELECT array_agg((value #>> '{}')::uuid) INTO v_ids FROM jsonb_array_elements(v_log.moved->'signals');
  UPDATE public.signals SET contact_id = v_log.duplicate_id WHERE id = ANY(coalesce(v_ids, '{}'));

  SELECT array_agg((value #>> '{}')::uuid) INTO v_ids FROM jsonb_array_elements(v_log.moved->'pending_signals');
  UPDATE public.pending_signals SET contact_id = v_log.duplicate_id WHERE id = ANY(coalesce(v_ids, '{}'));

  SELECT array_agg((value #>> '{}')::uuid) INTO v_ids FROM jsonb_array_elements(v_log.moved->'user_icebreakers');
  UPDATE public.user_icebreakers SET contact_id = v_log.duplicate_id WHERE id = ANY(coalesce(v_ids, '{}'));

  SELECT array_agg((value #>> '{}')::uuid) INTO v_ids FROM jsonb_array_elements(v_log.moved->'client_ai_executions');
  UPDATE v3.client_ai_executions SET contact_id = v_log.duplicate_id::text WHERE id = ANY(coalesce(v_ids, '{}'));

  UPDATE v3.contact_merges SET reverted_at = now() WHERE id = p_merge_id;

  RETURN jsonb_build_object(
    'merge_id', p_merge_id,
    'restored_contact_id', v_log.duplicate_id,
    'signals_no_restauradas', jsonb_array_length(coalesce(v_log.deleted->'signals', '[]'::jsonb)),
    'nota', 'Las señales borradas eran duplicado exacto de las del master y no se restauran.'
  );
END;
$function$;

-- ───────────────────────────────────────────────────────────────────
-- Detección de candidatos
-- ───────────────────────────────────────────────────────────────────

-- Grupos de filas que son la misma persona, con la regla que lo prueba.
--
-- TODAS exigen el mismo nombre normalizado. Sin esa guarda, "mismo email" une
-- a los seis que comparten info@empresa.com y "mismo sufijo" une a dos
-- personas distintas (398 de los 501 sufijos repetidos son colisión).
--
--   slug     dos filas con el MISMO slug canónico. Solo puede pasar si ya
--            había duplicados de antes: el UNIQUE sobre linkedin_url crudo no
--            los frena si difieren en acentos o en el guión final.
--   email    la persona cambió de vanity URL; el mail la sigue identificando.
--   phone    idem con el teléfono.
--   suffix   cambió el nombre visible y LinkedIn conservó el sufijo del slug.
--
-- `p_max_compartido` es la guarda contra conmutadores y casillas genéricas.
-- Medido: 1.676 teléfonos están en más de 20 contactos y hay uno en 4.941 —es
-- la central de la empresa, no el número de una persona. Un valor así no
-- identifica a nadie y lo único que lo salvaba era el nombre. Por encima del
-- tope el valor se descarta como identidad: preferimos dejar un duplicado sin
-- detectar antes que fusionar a dos homónimos de una empresa de 5.000 personas.
-- El slug no lleva tope: es único por perfil.
--
-- El orden de las operaciones importa para que esto corra. Primero se agrupa
-- `contact_identities` por (kind, value) —que es el prefijo de su PK— y recién
-- sobre los valores repetidos, que son pocos, se une a `contacts` para aplicar
-- la guarda de nombre. Al revés hay que normalizar el nombre de 2,1M filas y la
-- consulta no termina.
create or replace function public.get_duplicate_contact_candidates(
  p_limit integer default 100,
  p_rules text[] default array['slug','email','phone','suffix'],
  p_max_compartido integer default 5
)
returns table (
  rule text,
  identity_value text,
  full_name text,
  contact_ids uuid[],
  master_id uuid,
  n_filas integer,
  n_signals integer
)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  WITH repetidos AS (
    SELECT ci.kind, ci.value, array_agg(DISTINCT ci.contact_id) AS ids
    FROM public.contact_identities ci
    WHERE CASE ci.kind WHEN 'linkedin_slug' THEN 'slug'
                       WHEN 'linkedin_suffix' THEN 'suffix'
                       ELSE ci.kind END = ANY(p_rules)
    GROUP BY ci.kind, ci.value
    HAVING count(DISTINCT ci.contact_id) > 1
       AND (ci.kind = 'linkedin_slug' OR count(DISTINCT ci.contact_id) <= p_max_compartido)
  ),
  expandido AS (
    SELECT r.kind, r.value, cid, public.normalize_person_name(c.full_name) AS nombre
    FROM repetidos r
    CROSS JOIN LATERAL unnest(r.ids) AS cid
    JOIN public.contacts c ON c.id = cid
  ),
  grupos AS (
    SELECT CASE kind WHEN 'linkedin_slug' THEN 'slug'
                     WHEN 'linkedin_suffix' THEN 'suffix'
                     ELSE kind END AS rule,
           value, nombre, array_agg(DISTINCT cid) AS ids
    FROM expandido
    WHERE nombre IS NOT NULL
    GROUP BY 1, value, nombre
    HAVING count(DISTINCT cid) > 1
  )
  SELECT g.rule,
         g.value,
         g.nombre,
         g.ids,
         public.pick_contact_master(g.ids),
         array_length(g.ids, 1),
         (SELECT count(*)::int FROM public.signals s WHERE s.contact_id = ANY(g.ids))
  FROM grupos g
  ORDER BY array_length(g.ids, 1) DESC, g.rule, g.value
  LIMIT p_limit;
$function$;

-- ───────────────────────────────────────────────────────────────────
-- Corrida en lote
-- ───────────────────────────────────────────────────────────────────

-- Fusiona candidatos de a lotes. Pensada para correr varias veces: cada pasada
-- deja la base más limpia y la siguiente encuentra menos.
--
-- Es idempotente por construcción — cuando ya no quedan grupos, devuelve 0
-- fusiones — y cada fusión queda registrada en v3.contact_merges, así que una
-- corrida entera se puede deshacer una por una.
create or replace function public.auto_merge_contact_duplicates(
  p_limit integer default 100,
  p_rules text[] default array['slug','email','phone','suffix'],
  p_dry_run boolean default false,
  p_max_compartido integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'v3', 'pg_catalog'
as $function$
DECLARE
  v_grupo RECORD;
  v_dup UUID;
  v_fusiones INTEGER := 0;
  v_grupos INTEGER := 0;
  v_errores JSONB := '[]'::jsonb;
  v_por_regla JSONB := '{}'::jsonb;
  v_perfil_en_dup INTEGER := 0;
  v_res JSONB;
BEGIN
  FOR v_grupo IN
    SELECT * FROM public.get_duplicate_contact_candidates(p_limit, p_rules, p_max_compartido)
  LOOP
    v_grupos := v_grupos + 1;

    FOREACH v_dup IN ARRAY v_grupo.contact_ids LOOP
      CONTINUE WHEN v_dup = v_grupo.master_id;
      -- Un contacto puede aparecer en dos grupos del mismo lote (comparte mail
      -- con uno y teléfono con otro). Si ya lo fusionó el grupo anterior, no
      -- existe más y hay que saltearlo, no fallar.
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = v_dup);
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = v_grupo.master_id);

      BEGIN
        v_res := public.merge_contacts(
          v_grupo.master_id, v_dup, p_dry_run,
          v_grupo.rule, 1.0,
          format('auto: mismo nombre (%s) y %s compartido (%s)', v_grupo.full_name, v_grupo.rule, v_grupo.identity_value)
        );
        v_fusiones := v_fusiones + 1;
        v_por_regla := jsonb_set(v_por_regla, array[v_grupo.rule],
                                 to_jsonb(coalesce((v_por_regla->>v_grupo.rule)::int, 0) + 1));
        -- Cuántas veces el perfil vigente estaba en la fila que se borra. En el
        -- dry run sobre producción fue 1 de cada 4: es la medida de cuánto
        -- importa que el contenido lo aporte el más fresco y no el master.
        IF v_res->>'perfil_vigente' = 'el duplicado' THEN v_perfil_en_dup := v_perfil_en_dup + 1; END IF;
      EXCEPTION WHEN OTHERS THEN
        v_errores := v_errores || jsonb_build_object('duplicate_id', v_dup, 'error', SQLERRM);
      END;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'grupos_procesados', v_grupos,
    'fusiones', v_fusiones,
    'por_regla', v_por_regla,
    'el_perfil_vigente_estaba_en_la_fila_que_se_borra', v_perfil_en_dup,
    -- No devuelve cuántos grupos quedan a propósito: recalcularlo obliga a
    -- rehacer la detección entera en cada lote y la corrida se vuelve cuadrática.
    'errores', v_errores
  );
END;
$function$;
