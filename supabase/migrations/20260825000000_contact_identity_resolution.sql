-- ═══════════════════════════════════════════════════════════════════
-- Identidad de persona: dejar de crear un contacto nuevo cada vez que
-- LinkedIn cambia la URL del mismo perfil
--
-- El problema
-- -----------
-- `contacts` se deduplica con ON CONFLICT (linkedin_url) sobre el string CRUDO.
-- Esa URL no identifica a una persona: identifica a la URL. Medido sobre las
-- 544.808 filas con perfil:
--
--   * 6.312 filas son la misma persona repetida con evidencia fuerte —mismo
--     nombre normalizado más un identificador compartido:
--         email  2.826 grupos   phone  2.427   suffix  130   slug  101
--   * 6.386 filas tienen la URL con el URN ofuscado de LinkedIn
--     (/in/ACwAAAL5g4IB...) en vez del slug público: esa forma NUNCA coincide
--     con la del slug, así que cada vez que el scraper la devuelve nace una
--     fila nueva.
--   * 675 filas quedaron con `placeholder:<uuid>`: cuando el export no trae
--     LinkedIn, cada import crea otra fila de la misma persona.
--
-- Los tres mecanismos observados, con ejemplos reales:
--
--   1. La persona se pone una vanity URL. El export siguiente trae otra URL:
--        agustín-milhas-28a8861a9  →  amilhas
--        alejandra-giachero-15a21914  →  alejandragiachero
--      563 de los 937 grupos duplicados con email compartido son esto.
--
--   2. La persona cambia su nombre público y LinkedIn regenera el slug
--      conservando el sufijo:
--        adrián-gabriel-cavaiuolo-94541727  →  adrián-gabriel-c-94541727
--      El sufijo es el mismo perfil; el prefijo no.
--
--   3. El scraper devuelve el URN en vez del slug:
--        ACwAAAL5g4IB0ncXa9qmS21_NqzowZeTjfUSebc  y  oscar-fernando-g-14286914
--      creadas con un día de diferencia, misma persona.
--
-- Ninguno se arregla normalizando el string: la URL cambió de verdad. Lo que
-- hace falta es resolver IDENTIDAD antes de insertar.
--
-- La solución
-- -----------
-- `contact_identities`: todas las formas conocidas de identificar a un
-- contacto (slug, sufijo de perfil, emails, teléfonos), mantenidas por trigger.
-- Es además HISTORIAL: cuando una persona cambia de vanity URL, el slug viejo
-- sigue apuntando al mismo contacto, así que un export viejo no crea una fila
-- nueva. Es el mismo patrón que ya se usa para empresas con los merges
-- reversibles, aplicado a la identidad en vez de a la fusión.
--
-- `resolve_contact_id()` busca en ese índice por orden de fuerza y el ETL lo
-- consulta ANTES de insertar.
--
-- Por qué una tabla y no columnas generadas en `contacts`: agregar columnas
-- STORED reescribe la tabla entera y sus índices (contacts tiene cinco GIN
-- trigram, uno de ellos funcional), con ACCESS EXCLUSIVE. La tabla aparte se
-- crea vacía y se rellena con INSERT ... SELECT sin bloquear las lecturas.
--
-- El backfill de contact_identities son ~1,6M filas (545k contactos por sus
-- slugs, sufijos, mails y teléfonos) en un solo INSERT ... SELECT. Tarda, pero
-- escribe sobre una tabla vacía y recién creada: no compite con nadie.
--
-- Esta migración NO fusiona nada: solo deja de crear duplicados nuevos. La
-- fusión de los 6.312 existentes va en la migración siguiente.
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- 1. Normalizadores
--
-- Tienen gemelos en TypeScript (lib/shared/linkedin-profile.ts). Si cambia uno
-- hay que cambiar el otro: la UI pliega señales con la misma definición de
-- persona con la que el ETL decide si inserta o actualiza.
-- ───────────────────────────────────────────────────────────────────

-- Decodifica %XX. 299 URLs traen el nombre percent-encoded
-- (adri%C3%A1n-milhas) y sin decodificar no coinciden con la forma acentuada
-- del mismo slug.
create or replace function public.url_decode(p_text text)
returns text
language sql
immutable
as $function$
  select coalesce(
    (select convert_from(
       decode(string_agg(
         case when left(m[1], 1) = '%' then substring(m[1] from 2)
              else encode(convert_to(m[1], 'UTF8'), 'hex') end, ''), 'hex'), 'UTF8')
     from regexp_matches(p_text, '%[0-9a-fA-F]{2}|.', 'g') as m),
    p_text);
$function$;

comment on function public.url_decode(text) is
  'Decodifica secuencias %XX de una URL. Immutable: sirve para índices funcionales.';

-- Slug canónico de un perfil de persona.
--
-- No confundir con normalize_linkedin_url(), que es para /company/ y devuelve
-- la URL entera. Acá interesa el identificador, no la URL: sin protocolo, sin
-- dominio regional, sin query, sin acentos y sin la basura del final
-- ("agustín-torruella-" y "agustín-torruella" son el mismo perfil; hay 1.682
-- filas con guión colgado).
create or replace function public.contact_profile_slug(p_url text)
returns text
language plpgsql
immutable
as $function$
DECLARE
  v_slug TEXT;
BEGIN
  IF p_url IS NULL OR p_url = '' OR p_url LIKE 'placeholder:%' THEN RETURN NULL; END IF;

  -- url_decode() parte la URL carácter por carácter con un regex: es caro y solo
  -- 299 de las 544.808 filas lo necesitan. El resto se saltea el decodificado.
  IF strpos(p_url, '%') > 0 THEN
    v_slug := substring(lower(public.url_decode(p_url)) from 'linkedin\.com/in/([^/?#]+)');
  ELSE
    v_slug := substring(lower(p_url) from 'linkedin\.com/in/([^/?#]+)');
  END IF;
  IF v_slug IS NULL OR v_slug = '' THEN RETURN NULL; END IF;

  -- Acentos fuera: 88.891 URLs los traen y el mismo perfil aparece con y sin.
  v_slug := translate(v_slug, 'áàâäãéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ',
                              'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC');
  v_slug := regexp_replace(v_slug, '[^a-z0-9_-]', '', 'g');
  v_slug := regexp_replace(v_slug, '^-+|-+$', '', 'g');

  RETURN nullif(v_slug, '');
END;
$function$;

comment on function public.contact_profile_slug(text) is
  'Identificador canónico de un perfil de persona de LinkedIn. NULL si la URL no es un /in/.';

-- Sufijo autogenerado del slug: el id de perfil que LinkedIn conserva cuando la
-- persona cambia su nombre visible.
--
-- Solo se considera sufijo si tiene al menos un dígito: sin esa guarda,
-- "ana-abbaca" perdería el apellido, que es [a-f]{6} pero es un apellido.
-- No alcanza por sí solo para identificar (501 sufijos se repiten y 398 de esos
-- son personas distintas): siempre va acompañado del nombre.
create or replace function public.contact_profile_suffix(p_url text)
returns text
language plpgsql
immutable
as $function$
DECLARE
  v_suffix TEXT;
BEGIN
  v_suffix := substring(public.contact_profile_slug(p_url) from '-([0-9a-f]{6,12})$');
  IF v_suffix IS NULL OR v_suffix !~ '[0-9]' THEN RETURN NULL; END IF;
  RETURN v_suffix;
END;
$function$;

-- Nombre de persona comparable: sin acentos, sin puntuación, sin dobles
-- espacios. Es la GUARDA de todas las reglas de identidad débiles.
create or replace function public.normalize_person_name(p_name text)
returns text
language sql
immutable
as $function$
  SELECT nullif(
    trim(regexp_replace(
      lower(translate(coalesce(p_name, ''),
        'áàâäãéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ',
        'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC')),
      '[^a-z0-9]+', ' ', 'g')),
    '');
$function$;

-- Teléfono comparable: solo dígitos. Los datos traen +54 11 2753-7630 y
-- 541127537630 para la misma persona.
create or replace function public.normalize_phone_digits(p_phone text)
returns text
language sql
immutable
as $function$
  SELECT nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
$function$;

-- ───────────────────────────────────────────────────────────────────
-- 2. El índice de identidades
-- ───────────────────────────────────────────────────────────────────

-- Solo entra acá lo que IDENTIFICA a una persona. El proveedor de datos ya nos
-- dice qué dato es real y cuál adivinó, y hay que creerle:
--
--   email    solo con `status = 'valid'`. Los 289.171 restantes son en su
--            mayoría `accept_all_unverifiable`: el dominio es catch-all y el
--            proveedor construyó la dirección con el patrón inicial+apellido.
--            Dos homónimos de la misma empresa reciben el MISMO mail adivinado.
--            Caso real: aalvarez@falabella.com aparece en dos "Alejandro
--            Álvarez" distintos —uno fotógrafo en Falabella, otro subgerente en
--            Sodimac, ambas del grupo Falabella— y son dos personas.
--
--            EXCEPCIÓN: si el export no trajo `status` —la columna no vino, o
--            la lista se armó a mano— y el dominio es personal
--            (gmail/hotmail/...), el mail entra igual. Un mail adivinado es
--            SIEMPRE corporativo: el patrón necesita el dominio de la empresa,
--            y nadie puede deducir alejandroa3r@gmail.com de un nombre. O sea,
--            el riesgo que motiva todo este filtro no existe en dominios
--            personales. Hoy son 7.744 contactos que si no quedarían mudos.
--            Si el proveedor SÍ opinó y dijo que no pudo verificar, le creemos:
--            la excepción es para cuando no hay opinión, no para discutirla.
--
--   phone    solo con `type = 'personal'`. El 78% de los teléfonos están
--            tipados `company`: son el conmutador. Por eso un mismo número
--            aparece en 4.941 contactos. Acá no hay excepción posible: no se
--            puede saber si un número es celular o central mirándolo, así que
--            sin `type` el teléfono no identifica. Lo cubre la alarma de
--            finalize_batch_upload().
--
-- El filtro no es cosmético: baja los candidatos a fusión de 3.566 grupos a
-- ~2.100, y los que se caen son justamente los falsos positivos.
create table if not exists public.contact_identities (
  contact_id uuid not null references public.contacts(id) on delete cascade,
  kind text not null check (kind in ('linkedin_slug', 'linkedin_suffix', 'email', 'phone')),
  value text not null,
  first_seen_at timestamptz not null default now(),
  primary key (kind, value, contact_id)
);

comment on table public.contact_identities is
  'Todas las formas conocidas de identificar a un contacto. Es historial: un slug viejo se conserva para que un export anterior resuelva al mismo contacto en vez de crear otro.';

create index if not exists idx_contact_identities_contact on public.contact_identities (contact_id);

alter table public.contact_identities enable row level security;

-- Se lee y se escribe desde funciones SECURITY DEFINER (el ETL) y desde el
-- service role. Sin políticas, nadie más la toca.
grant select on public.contact_identities to authenticated;

drop policy if exists contact_identities_read on public.contact_identities;
create policy contact_identities_read on public.contact_identities
  for select to authenticated using (true);

-- Mantenimiento automático. Nunca borra: las identidades viejas son las que
-- evitan que un export anterior cree una fila nueva.
create or replace function public.sync_contact_identities()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_value TEXT;
BEGIN
  INSERT INTO public.contact_identities (contact_id, kind, value)
  SELECT NEW.id, kind, value FROM (
    SELECT 'linkedin_slug' AS kind, public.contact_profile_slug(NEW.linkedin_url) AS value
    UNION ALL
    SELECT 'linkedin_suffix', public.contact_profile_suffix(NEW.linkedin_url)
    UNION ALL
    SELECT 'email', lower(trim(e.v))
    FROM (VALUES (NEW.email1, NEW.email1_status), (NEW.email2, NEW.email2_status),
                 (NEW.email3, NEW.email3_status), (NEW.email4, NEW.email4_status)) AS e(v, st)
    WHERE e.st = 'valid'
       OR (coalesce(e.st, '') = '' AND public.is_personal_email(e.v))
    UNION ALL
    SELECT 'phone', public.normalize_phone_digits(p.v)
    FROM (VALUES (NEW.phone1, NEW.phone1_type), (NEW.phone2, NEW.phone2_type)) AS p(v, tp)
    WHERE p.tp = 'personal'
  ) t
  WHERE value IS NOT NULL AND value <> ''
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

drop trigger if exists trg_sync_contact_identities on public.contacts;
create trigger trg_sync_contact_identities
  after insert or update of linkedin_url, email1, email2, email3, email4, phone1, phone2
  on public.contacts
  for each row execute function public.sync_contact_identities();

-- Backfill. INSERT ... SELECT sobre una tabla vacía: no toca `contacts`, no
-- bloquea lecturas y es reejecutable.
insert into public.contact_identities (contact_id, kind, value)
select c.id, t.kind, t.value
from public.contacts c
cross join lateral (
  select 'linkedin_slug' as kind, public.contact_profile_slug(c.linkedin_url) as value
  union all
  select 'linkedin_suffix', public.contact_profile_suffix(c.linkedin_url)
  union all
  select 'email', lower(trim(e.v))
  from (values (c.email1, c.email1_status), (c.email2, c.email2_status),
               (c.email3, c.email3_status), (c.email4, c.email4_status)) as e(v, st)
  where e.st = 'valid'
     or (coalesce(e.st, '') = '' and public.is_personal_email(e.v))
  union all
  select 'phone', public.normalize_phone_digits(p.v)
  from (values (c.phone1, c.phone1_type), (c.phone2, c.phone2_type)) as p(v, tp)
  where p.tp = 'personal'
) t
where t.value is not null and t.value <> ''
on conflict do nothing;

-- ───────────────────────────────────────────────────────────────────
-- 3. La resolución
-- ───────────────────────────────────────────────────────────────────

-- Cuál de varias filas de la misma persona es la buena: la que ya tiene la
-- evidencia colgada (las señales), después la que tiene perfil real en vez de
-- placeholder, después la más completa, y a igualdad la más recientemente
-- actualizada. Gemelo de pick_merge_master() para empresas.
create or replace function public.pick_contact_master(p_ids uuid[])
returns uuid
language sql
stable
set search_path to 'public', 'pg_catalog'
as $function$
  SELECT c.id
  FROM public.contacts c
  LEFT JOIN LATERAL (
    SELECT count(*) AS n FROM public.signals s WHERE s.contact_id = c.id
  ) sig ON true
  WHERE c.id = ANY(p_ids)
  ORDER BY
    sig.n DESC NULLS LAST,
    (c.linkedin_url NOT LIKE 'placeholder:%') DESC,
    ((c.email1 IS NOT NULL)::int + (c.phone1 IS NOT NULL)::int
     + (c.about IS NOT NULL)::int + (c.profile_picture_url IS NOT NULL)::int) DESC,
    c.updated_at DESC NULLS LAST,
    c.created_at ASC
  LIMIT 1;
$function$;

-- Devuelve el contacto que YA representa a esta persona, o NULL.
--
-- Orden de fuerza, y en cada nivel: si hay más de un candidato NO resuelve.
-- Ante la duda preferimos un duplicado a fusionar dos personas distintas —
-- el duplicado se ve y se arregla, la fusión errónea mezcla el historial de
-- dos personas y no se nota.
--
--   1. slug exacto      — es el mismo perfil, sin ambigüedad posible.
--   2. sufijo + nombre  — la persona cambió su nombre visible.
--   3. email + nombre   — la persona cambió de vanity URL.
--   4. teléfono + nombre
--
-- El nombre es obligatorio de 2 a 4 porque email y teléfono se comparten
-- (casillas genéricas, conmutadores) y el sufijo colisiona.
--
-- Y en 3 y 4 hay además un VETO: si las dos filas tienen sufijo autogenerado y
-- son DISTINTOS, son dos cuentas de LinkedIn distintas y no se fusionan por
-- evidencia indirecta. El sufijo es el id del perfil, así que dos sufijos
-- distintos no pueden ser el mismo perfil:
--
--   alejandro-alvarez-03aa2b32  vs  alejandro-alvarez-1457832ab
--     → dos personas distintas que comparten un mail adivinado. VETO.
--
--   matias-ezequiel-merino-b36b54260  vs  matias-ezequiel-merino
--     → uno tiene sufijo y el otro es la vanity URL: es el mismo perfil
--       scrapeado antes y después del cambio. NO hay veto.
--
--   adrian-gabriel-cavaiuolo-94541727  vs  adrian-gabriel-c-94541727
--     → mismo sufijo, cambió el nombre visible. NO hay veto.
--
-- Cuesta 123 grupos de los 1.683 que pasan el filtro de email verificado. Es
-- deliberado: una persona con dos cuentas reales de LinkedIn queda sin fusionar,
-- y eso es preferible a mezclar a dos homónimos.
create or replace function public.resolve_contact_id(
  p_linkedin_url text,
  p_full_name text,
  p_emails text[] default null,
  p_phones text[] default null
)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
DECLARE
  v_slug   TEXT := public.contact_profile_slug(p_linkedin_url);
  v_suffix TEXT := public.contact_profile_suffix(p_linkedin_url);
  v_name   TEXT := public.normalize_person_name(p_full_name);
  v_ids    UUID[];
BEGIN
  IF v_slug IS NOT NULL THEN
    SELECT array_agg(DISTINCT ci.contact_id) INTO v_ids
    FROM public.contact_identities ci
    WHERE ci.kind = 'linkedin_slug' AND ci.value = v_slug;

    IF array_length(v_ids, 1) = 1 THEN RETURN v_ids[1]; END IF;
    -- Si el slug apunta a varios contactos hay duplicados sin fusionar: se
    -- elige el que más señales tiene, que es el que la UI ya viene mostrando.
    IF array_length(v_ids, 1) > 1 THEN RETURN public.pick_contact_master(v_ids); END IF;
  END IF;

  IF v_name IS NULL THEN RETURN NULL; END IF;

  IF v_suffix IS NOT NULL THEN
    SELECT array_agg(DISTINCT ci.contact_id) INTO v_ids
    FROM public.contact_identities ci
    JOIN public.contacts c ON c.id = ci.contact_id
    WHERE ci.kind = 'linkedin_suffix' AND ci.value = v_suffix
      AND public.normalize_person_name(c.full_name) = v_name;

    IF array_length(v_ids, 1) = 1 THEN RETURN v_ids[1]; END IF;
  END IF;

  -- De acá en adelante la evidencia es indirecta y aplica el veto del sufijo:
  -- `contact_profile_suffix(c.linkedin_url) IS DISTINCT FROM v_suffix` descarta
  -- al candidato solo cuando LOS DOS tienen sufijo y no coinciden. Si alguno es
  -- NULL (vanity URL o URN ofuscado) no hay con qué contradecir y pasa.
  IF p_emails IS NOT NULL THEN
    SELECT array_agg(DISTINCT ci.contact_id) INTO v_ids
    FROM public.contact_identities ci
    JOIN public.contacts c ON c.id = ci.contact_id
    WHERE ci.kind = 'email'
      AND ci.value = ANY (SELECT lower(trim(e)) FROM unnest(p_emails) e WHERE e IS NOT NULL AND trim(e) <> '')
      AND public.normalize_person_name(c.full_name) = v_name
      AND NOT (v_suffix IS NOT NULL
               AND public.contact_profile_suffix(c.linkedin_url) IS NOT NULL
               AND public.contact_profile_suffix(c.linkedin_url) <> v_suffix);

    IF array_length(v_ids, 1) = 1 THEN RETURN v_ids[1]; END IF;
  END IF;

  IF p_phones IS NOT NULL THEN
    SELECT array_agg(DISTINCT ci.contact_id) INTO v_ids
    FROM public.contact_identities ci
    JOIN public.contacts c ON c.id = ci.contact_id
    WHERE ci.kind = 'phone'
      AND ci.value = ANY (SELECT public.normalize_phone_digits(p) FROM unnest(p_phones) p WHERE p IS NOT NULL)
      AND public.normalize_person_name(c.full_name) = v_name
      AND NOT (v_suffix IS NOT NULL
               AND public.contact_profile_suffix(c.linkedin_url) IS NOT NULL
               AND public.contact_profile_suffix(c.linkedin_url) <> v_suffix);

    IF array_length(v_ids, 1) = 1 THEN RETURN v_ids[1]; END IF;
  END IF;

  RETURN NULL;
END;
$function$;


-- ───────────────────────────────────────────────────────────────────
-- 4. El ETL resuelve identidad antes de escribir
--
-- La única escritura sigue siendo el mismo INSERT ... ON CONFLICT (linkedin_url)
-- de siempre. Lo que cambia es CONTRA QUÉ URL choca: si la persona ya existe
-- bajo otra URL, se le reapunta la suya a la nueva forma y el ON CONFLICT cae
-- sobre esa fila en vez de crear una. Así no hay dos caminos de escritura que
-- puedan divergir.
--
-- El slug viejo NO se pierde: queda en contact_identities, así que un export
-- anterior sigue resolviendo a la misma persona.
--
-- Base: la definición VIVA en producción (no la del 20260820120000, que tiene
-- comentarios que la desplegada no trae). Los únicos cambios son el bloque de
-- resolución y el COALESCE de emails/teléfonos.
-- ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.process_contact_batch_internal(p_batch_id uuid, p_limit integer DEFAULT 5)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_row RECORD;
  v_processed_count INTEGER := 0;
  v_retry_count INTEGER := 0;
  v_max_retries INTEGER := 3;
  v_retry_delay INTEGER;
  v_current_company_id UUID;
  v_contact_id UUID;
  v_prev_company_id UUID;
  v_prev_positions JSONB := '[]'::JSONB;
  v_position_obj JSONB;
  v_resolved_id UUID;
  v_linkedin_url TEXT;
BEGIN
  FOR v_row IN
    SELECT * FROM public.import_rows
    WHERE batch_id = p_batch_id AND status = 'pending'
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    v_retry_count := 0;

    <<retry_loop>>
    LOOP
      BEGIN
        v_current_company_id := public.upsert_company(
          (v_row.row_data->>'company_name')::TEXT,
          (v_row.row_data->>'company_linkedin_url')::TEXT,
          (v_row.row_data->>'company_website')::TEXT,
          (v_row.row_data->>'company_industry')::TEXT,
          (v_row.row_data->>'company_country')::TEXT,
          (v_row.row_data->>'company_logo_url')::TEXT,
          (v_row.row_data->>'company_description')::TEXT
        );

        v_prev_positions := '[]'::JSONB;
        FOR i IN 1..6 LOOP
          IF v_row.row_data ? ('previous_company_' || i) AND
             (v_row.row_data->>('previous_company_' || i)) IS NOT NULL AND
             (v_row.row_data->>('previous_company_' || i)) != '' THEN

            v_prev_company_id := public.upsert_company(
              (v_row.row_data->>('previous_company_' || i))::TEXT,
              NULL, NULL, NULL, NULL, NULL, NULL
            );

            v_position_obj := jsonb_strip_nulls(jsonb_build_object(
              'company_id', v_prev_company_id,
              'company_name', v_row.row_data->>('previous_company_' || i),
              'title', v_row.row_data->>('previous_position_' || i),
              'description', v_row.row_data->>('previous_position_' || i || '_description'),
              'started_on', public.parse_position_date(v_row.row_data->>('previous_position_' || i || '_started_at')),
              'ended_on', public.parse_position_date(v_row.row_data->>('previous_position_' || i || '_ended_at'))
            ));

            v_prev_positions := v_prev_positions || v_position_obj;
          END IF;
        END LOOP;

        -- ── Resolución de identidad ──
        v_linkedin_url := nullif(trim(v_row.row_data->>'linkedin_url'), '');

        v_resolved_id := public.resolve_contact_id(
          v_linkedin_url,
          v_row.row_data->>'full_name',
          ARRAY[v_row.row_data->>'email1', v_row.row_data->>'email2',
                v_row.row_data->>'email3', v_row.row_data->>'email4'],
          ARRAY[v_row.row_data->>'phone1', v_row.row_data->>'phone2']
        );

        IF v_resolved_id IS NOT NULL THEN
          IF v_linkedin_url IS NULL THEN
            -- El export no trae LinkedIn. Antes esto generaba un placeholder
            -- nuevo por import; ahora se reusa la URL del contacto ya resuelto.
            SELECT c.linkedin_url INTO v_linkedin_url FROM public.contacts c WHERE c.id = v_resolved_id;
          ELSE
            -- La persona cambió de URL: la fila existente pasa a la forma nueva
            -- para que el ON CONFLICT de abajo la actualice. Si esa URL ya la
            -- tiene otra fila (duplicado sin fusionar), se deja como está y el
            -- ON CONFLICT cae sobre esa otra: en ninguno de los dos casos se
            -- crea una fila nueva.
            UPDATE public.contacts c
               SET linkedin_url = v_linkedin_url
             WHERE c.id = v_resolved_id
               AND c.linkedin_url IS DISTINCT FROM v_linkedin_url
               AND NOT EXISTS (
                 SELECT 1 FROM public.contacts o
                 WHERE o.linkedin_url = v_linkedin_url AND o.id <> v_resolved_id
               );
          END IF;
        END IF;

        IF v_linkedin_url IS NULL THEN
          v_linkedin_url := 'placeholder:' || gen_random_uuid()::TEXT;
        END IF;

        INSERT INTO public.contacts (
          linkedin_url, first_name, last_name, full_name, headline, about,
          current_company_id, current_position_title, current_position_description,
          current_position_started_on,
          previous_positions, country, profile_picture_url,
          email1, email1_type, email1_status,
          email2, email2_type, email2_status,
          email3, email3_type, email3_status,
          email4, email4_type, email4_status,
          phone1, phone1_type, phone1_status,
          phone2, phone2_type, phone2_status
        ) VALUES (
          v_linkedin_url,
          (v_row.row_data->>'first_name')::TEXT, (v_row.row_data->>'last_name')::TEXT,
          (v_row.row_data->>'full_name')::TEXT, (v_row.row_data->>'headline')::TEXT,
          (v_row.row_data->>'about')::TEXT, v_current_company_id,
          (v_row.row_data->>'current_position')::TEXT, (v_row.row_data->>'current_position_description')::TEXT,
          public.parse_position_date(v_row.row_data->>'current_position_started_at'),
          v_prev_positions, (v_row.row_data->>'country')::TEXT, (v_row.row_data->>'profile_picture_url')::TEXT,
          (v_row.row_data->>'email1')::TEXT, (v_row.row_data->>'email1_type')::TEXT, (v_row.row_data->>'email1_status')::TEXT,
          (v_row.row_data->>'email2')::TEXT, (v_row.row_data->>'email2_type')::TEXT, (v_row.row_data->>'email2_status')::TEXT,
          (v_row.row_data->>'email3')::TEXT, (v_row.row_data->>'email3_type')::TEXT, (v_row.row_data->>'email3_status')::TEXT,
          (v_row.row_data->>'email4')::TEXT, (v_row.row_data->>'email4_type')::TEXT, (v_row.row_data->>'email4_status')::TEXT,
          (v_row.row_data->>'phone1')::TEXT, (v_row.row_data->>'phone1_type')::TEXT, (v_row.row_data->>'phone1_status')::TEXT,
          (v_row.row_data->>'phone2')::TEXT, (v_row.row_data->>'phone2_type')::TEXT, (v_row.row_data->>'phone2_status')::TEXT
        )
        ON CONFLICT (linkedin_url) DO UPDATE SET
          first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, full_name = EXCLUDED.full_name,
          headline = EXCLUDED.headline, about = EXCLUDED.about, current_company_id = EXCLUDED.current_company_id,
          current_position_title = EXCLUDED.current_position_title, current_position_description = EXCLUDED.current_position_description,
          current_position_started_on = COALESCE(EXCLUDED.current_position_started_on, public.contacts.current_position_started_on),
          previous_positions = EXCLUDED.previous_positions, country = EXCLUDED.country, profile_picture_url = EXCLUDED.profile_picture_url,
          -- Rellenar huecos, nunca pisar. Al dejar de crear una fila por export,
          -- el contacto de datos del export tiene que llegar igual a la fila que
          -- ya existe: si no, deduplicar perdería teléfonos y mails.
          email1 = COALESCE(public.contacts.email1, EXCLUDED.email1),
          email1_type = COALESCE(public.contacts.email1_type, EXCLUDED.email1_type),
          email1_status = COALESCE(public.contacts.email1_status, EXCLUDED.email1_status),
          email2 = COALESCE(public.contacts.email2, EXCLUDED.email2),
          email2_type = COALESCE(public.contacts.email2_type, EXCLUDED.email2_type),
          email2_status = COALESCE(public.contacts.email2_status, EXCLUDED.email2_status),
          email3 = COALESCE(public.contacts.email3, EXCLUDED.email3),
          email3_type = COALESCE(public.contacts.email3_type, EXCLUDED.email3_type),
          email3_status = COALESCE(public.contacts.email3_status, EXCLUDED.email3_status),
          email4 = COALESCE(public.contacts.email4, EXCLUDED.email4),
          email4_type = COALESCE(public.contacts.email4_type, EXCLUDED.email4_type),
          email4_status = COALESCE(public.contacts.email4_status, EXCLUDED.email4_status),
          phone1 = COALESCE(public.contacts.phone1, EXCLUDED.phone1),
          phone1_type = COALESCE(public.contacts.phone1_type, EXCLUDED.phone1_type),
          phone1_status = COALESCE(public.contacts.phone1_status, EXCLUDED.phone1_status),
          phone2 = COALESCE(public.contacts.phone2, EXCLUDED.phone2),
          phone2_type = COALESCE(public.contacts.phone2_type, EXCLUDED.phone2_type),
          phone2_status = COALESCE(public.contacts.phone2_status, EXCLUDED.phone2_status),
          updated_at = timezone('utc'::text, now())
        RETURNING id INTO v_contact_id;

        PERFORM public.process_contact_signals(v_contact_id);

        UPDATE public.import_rows SET status = 'processed', processed_at = timezone('utc'::text, now()) WHERE id = v_row.id;
        v_processed_count := v_processed_count + 1;

        EXIT retry_loop;

      EXCEPTION
        WHEN serialization_failure OR deadlock_detected THEN
          v_retry_count := v_retry_count + 1;

          IF v_retry_count >= v_max_retries THEN
            INSERT INTO public.debug_events (batch_id, event_type, message, details)
            VALUES (p_batch_id, 'row_error', 'Error processing contact row',
              jsonb_build_object('row_id', v_row.id, 'error', SQLERRM, 'retries_exhausted', v_retry_count));

            UPDATE public.import_rows
            SET status = 'failed', error_message = 'Deadlock after ' || v_retry_count || ' retries: ' || SQLERRM
            WHERE id = v_row.id;

            EXIT retry_loop;
          ELSE
            v_retry_delay := 10 * (5 ^ (v_retry_count - 1));

            INSERT INTO public.debug_events (batch_id, event_type, message, details)
            VALUES (p_batch_id, 'row_retry', 'Retrying contact row after deadlock',
              jsonb_build_object('row_id', v_row.id, 'retry_count', v_retry_count, 'delay_ms', v_retry_delay));

            PERFORM pg_sleep(v_retry_delay::FLOAT / 1000.0);

            CONTINUE retry_loop;
          END IF;

        WHEN OTHERS THEN
          INSERT INTO public.debug_events (batch_id, event_type, message, details)
          VALUES (p_batch_id, 'row_error', 'Error processing contact row',
            jsonb_build_object('row_id', v_row.id, 'error', SQLERRM));

          UPDATE public.import_rows
          SET status = 'failed', error_message = SQLERRM
          WHERE id = v_row.id;

          EXIT retry_loop;
      END;
    END LOOP;
  END LOOP;

  RETURN v_processed_count;
END;
$function$;

-- ───────────────────────────────────────────────────────────────────
-- 5. Alarma: avisar cuando el export llega sin los campos de identidad
--
-- El mapeo de columnas del upload es literal (`email1_status: row.email1_status`
-- en app/actions/ingest.ts): si el proveedor renombra la columna, o alguien
-- sube una lista armada a mano, el campo llega NULL y el mail deja de
-- identificar. El import termina "OK" y el efecto —volver a crear duplicados—
-- recién se nota meses después.
--
-- Hoy ya hay 10.716 contactos con mail sin `status` y 8.833 con teléfono sin
-- `type`. Esto no los arregla; hace que la próxima vez se vea en la primera
-- corrida, en la respuesta del upload y en debug_events.
-- ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.finalize_batch_upload(p_batch_id uuid, p_total_rows integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actual_rows INTEGER;
  v_batch_type  TEXT;
  v_cobertura   JSONB := NULL;
BEGIN
  SELECT COUNT(*) INTO v_actual_rows FROM public.import_rows WHERE batch_id = p_batch_id;

  IF v_actual_rows <> p_total_rows THEN
    UPDATE public.import_batches
    SET status = 'failed',
        error_message = format('Row count mismatch on upload: expected %s, found %s', p_total_rows, v_actual_rows),
        total_rows = v_actual_rows, updated_at = timezone('utc', now())
    WHERE id = p_batch_id;
    RETURN jsonb_build_object('status','failed','expected',p_total_rows,'found',v_actual_rows);
  END IF;

  UPDATE public.import_batches
  SET status = 'pending', total_rows = v_actual_rows, updated_at = timezone('utc', now())
  WHERE id = p_batch_id;

  SELECT batch_type INTO v_batch_type FROM public.import_batches WHERE id = p_batch_id;

  IF coalesce(v_batch_type, 'contacts') = 'contacts' THEN
    SELECT jsonb_build_object(
      'filas_con_email',    count(*) FILTER (WHERE nullif(trim(row_data->>'email1'), '') IS NOT NULL),
      'email_sin_status',   count(*) FILTER (WHERE nullif(trim(row_data->>'email1'), '') IS NOT NULL
                                               AND coalesce(row_data->>'email1_status', '') = ''),
      'filas_con_telefono', count(*) FILTER (WHERE nullif(trim(row_data->>'phone1'), '') IS NOT NULL),
      'telefono_sin_type',  count(*) FILTER (WHERE nullif(trim(row_data->>'phone1'), '') IS NOT NULL
                                               AND coalesce(row_data->>'phone1_type', '') = '')
    ) INTO v_cobertura
    FROM public.import_rows WHERE batch_id = p_batch_id;

    IF (v_cobertura->>'email_sin_status')::int > 0 OR (v_cobertura->>'telefono_sin_type')::int > 0 THEN
      INSERT INTO public.debug_events (batch_id, event_type, message, details)
      VALUES (p_batch_id, 'identity_fields_missing',
              'El export no trae email1_status y/o phone1_type: esas filas no se van a poder deduplicar por mail ni por teléfono',
              v_cobertura);
    END IF;
  END IF;

  INSERT INTO public.debug_events (batch_id, event_type, message, details)
  VALUES (p_batch_id, 'upload_finalized', 'All rows inserted, batch queued',
          jsonb_build_object('total_rows', v_actual_rows));

  RETURN jsonb_build_object('status','pending','total_rows',v_actual_rows)
         || CASE WHEN v_cobertura IS NULL THEN '{}'::jsonb
                 ELSE jsonb_build_object('identity_coverage', v_cobertura) END;
END; $function$;
