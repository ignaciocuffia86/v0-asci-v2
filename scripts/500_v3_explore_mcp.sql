-- =============================================================================
-- MCP Explore (paralelo al MCP actual, para A/B).
--
-- Embudo conversacional sobre la tabla CRUDA de contactos + vacantes, SIN pasar
-- por el diccionario de senales de v2. Todo vive en el schema v3 y es de solo
-- LECTURA sobre las tablas de v2 (public.contacts, public.companies,
-- public.job_postings, public.master_industries). El unico punto que ESCRIBE en
-- v2 es el scraping de Apify, que se reusa tal cual del MCP actual y no se toca
-- aca.
--
-- Regla de oro del proyecto: v2 esta en produccion y no se puede romper. Esta
-- migracion no crea, altera ni indexa NINGUNA tabla de v2: solo agrega objetos
-- nuevos en el schema v3 y funciones que LEEN v2.
--
-- Tecnica de busqueda validada contra la base real:
--   - Cada termino es su propio ILIKE '%term%' (usa el indice GIN trigram). Un
--     regex de alternancia \y(a|b|c)\y NO usa el indice y fue 10x mas lento.
--   - Encima se refina con ~* '\yterm\y' (limite de palabra) para descartar los
--     falsos positivos de substring (WhatsApp -> "sap", Isapre -> "sap"). Ese
--     regex corre solo sobre las pocas filas que ya paso el ILIKE, asi que no
--     cuesta nada.
--   - El "concepto" (los terminos) SIEMPRE va en cada consulta: es el filtro mas
--     selectivo (por indice), mientras que industria NO tiene indice. Facetar
--     industria "en frio" sin concepto era 18s; con concepto por delante, <2s.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Sesiones de exploracion.
--    El embudo es stateful: el server recuerda los cortes ya elegidos (concepto
--    + pais + industrias) entre llamadas y devuelve un token. Cada tool arrastra
--    igual el concepto embebido; la sesion evita reenviar todo el estado.
-- -----------------------------------------------------------------------------
create table if not exists v3.explore_sessions (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  user_id       uuid not null,
  -- Concepto original tal como lo pidio el usuario ("SAP"), para poder mostrarlo.
  concept       text,
  -- Nube de tags expandida por el cliente MCP: ["SAP","S/4HANA","ABAP",...].
  terms         text[] not null default '{}',
  -- Corte geografico ya elegido (nombre de pais normalizado, ej "Argentina").
  country       text,
  -- Hasta 3 master_industries elegidas (ids). Vacio = sin corte de industria.
  industry_ids  text[] not null default '{}',
  -- Si el corte de industria incluye tambien las empresas SIN clasificar.
  include_unclassified boolean not null default true,
  -- Fuentes de senal activas: 'contacts' (gente que sabe) y/o 'jobs' (empresas
  -- que buscan). Por defecto las dos.
  sources       text[] not null default array['contacts','jobs'],
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Las sesiones son efimeras; se limpian por fecha, no hay dato valioso ahi.
  expires_at    timestamptz not null default now() + interval '7 days'
);

create index if not exists explore_sessions_ws_idx
  on v3.explore_sessions (workspace_id, user_id, created_at desc);

comment on table v3.explore_sessions is
  'Estado del embudo del MCP Explore: concepto/terminos + cortes de pais e industria. Efimero (7 dias).';

-- -----------------------------------------------------------------------------
-- 2. Helper: arma el predicado de texto (index-friendly + refinado por palabra).
--    Devuelve una cadena SQL para inyectar en un WHERE via EXECUTE.
--
--    Estructura del predicado, por cada columna de texto y cada termino:
--      ( col ILIKE '%term%' OR ... )       <- usa el indice GIN trigram (rapido)
--      AND
--      ( col ~* '\yterm\y' OR ... )         <- descarta falsos positivos de substring
--
--    Se usa quote_literal/format(%I,%L) para que no haya inyeccion: los terminos
--    llegan como datos, nunca se concatenan crudos.
-- -----------------------------------------------------------------------------
create or replace function v3._explore_predicate(
  p_alias text,
  p_cols  text[],
  p_like  text[],   -- terminos ya envueltos en % (ej '%SAP%'), con % y _ escapados
  p_regex text[]    -- terminos regex-escapados (sin \y; se agregan aca)
) returns text
language plpgsql
immutable
as $$
declare
  col text;
  t   text;
  like_ors  text[] := '{}';
  regex_ors text[] := '{}';
begin
  if p_like is null or array_length(p_like, 1) is null then
    -- Sin terminos no hay busqueda de texto: predicado imposible para no devolver
    -- toda la tabla por error.
    return 'false';
  end if;

  foreach col in array p_cols loop
    foreach t in array p_like loop
      like_ors := like_ors || format('%I.%I ILIKE %L', p_alias, col, t);
    end loop;
    foreach t in array p_regex loop
      regex_ors := regex_ors || format('%I.%I ~* %L', p_alias, col, '\y' || t || '\y');
    end loop;
  end loop;

  return '(' || array_to_string(like_ors, ' OR ') || ') AND ('
             || array_to_string(regex_ors, ' OR ') || ')';
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Faceta de pais. Primer corte del embudo: "SAP aparece en que paises".
--    Siempre con el concepto aplicado (por indice), asi que es rapido.
-- -----------------------------------------------------------------------------
create or replace function v3.explore_geo_facets(
  p_like  text[],
  p_regex text[],
  p_limit int default 30
) returns table (country text, person_matches bigint)
language plpgsql
stable
as $$
declare
  pred text := v3._explore_predicate(
    'c',
    array['headline','about','current_position_title','current_position_description'],
    p_like, p_regex
  );
begin
  return query execute format($q$
    select c.country_normalized, count(*)::bigint
    from public.contacts c
    where %s and c.country_normalized is not null and c.country_normalized <> ''
    group by c.country_normalized
    order by count(*) desc
    limit %s
  $q$, pred, p_limit);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Faceta de industria. Segundo corte: dado concepto (+ pais), que industrias.
--    Usa la industria NORMALIZADA (28 master_industries, bilingue), no el texto
--    libre de companies.industry. Incluye una fila para las SIN clasificar
--    (master_industry_id NULL), que son la mayoria, para que el modelo avise.
-- -----------------------------------------------------------------------------
create or replace function v3.explore_industry_facets(
  p_like    text[],
  p_regex   text[],
  p_country text default null,
  p_limit   int default 30
) returns table (
  master_industry_id text,
  name_es text,
  name_en text,
  person_matches bigint
)
language plpgsql
stable
as $$
declare
  pred text := v3._explore_predicate(
    'c',
    array['headline','about','current_position_title','current_position_description'],
    p_like, p_regex
  );
begin
  return query execute format($q$
    select co.master_industry_id::text,
           mi.name_es,
           mi.name_en,
           count(*)::bigint
    from public.contacts c
    join public.companies co on co.id = c.current_company_id
    left join public.master_industries mi on mi.id = co.master_industry_id
    where %s
      and (%L is null or c.country_normalized = %L)
    group by co.master_industry_id, mi.name_es, mi.name_en
    order by count(*) desc
    limit %s
  $q$, pred, p_country, p_country, p_limit);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Busqueda de empresas: el resultado del embudo. Combina las DOS fuentes
--    (contacts = gente que sabe, jobs = empresas que buscan) y devuelve por
--    empresa el conteo de cada una. El ranking se ordena por el total.
--
--    p_search_contacts / p_search_jobs permiten apagar una fuente (si estan en
--    false, su predicado se fuerza a 'false' y esa rama no aporta nada).
-- -----------------------------------------------------------------------------
create or replace function v3.explore_search_companies(
  p_like    text[],
  p_regex   text[],
  p_country text default null,
  p_industry_ids text[] default null,
  p_include_unclassified boolean default true,
  p_search_contacts boolean default true,
  p_search_jobs boolean default true,
  p_limit   int default 25
) returns table (
  company_id uuid,
  company_name text,
  country_normalized text,
  master_industry_id text,
  industry_name_es text,
  person_matches bigint,
  job_matches bigint,
  total_matches bigint
)
language plpgsql
stable
as $$
declare
  contact_pred text := case when p_search_contacts then
    v3._explore_predicate('c',
      array['headline','about','current_position_title','current_position_description'],
      p_like, p_regex)
    else 'false' end;
  job_pred text := case when p_search_jobs then
    v3._explore_predicate('j', array['title','description'], p_like, p_regex)
    else 'false' end;
  -- Filtro de industria: si viene lista, se exige que la empresa este en ella;
  -- include_unclassified suma tambien las de master_industry_id NULL.
  industry_filter text;
begin
  if p_industry_ids is null or array_length(p_industry_ids, 1) is null then
    industry_filter := 'true';
  elsif p_include_unclassified then
    industry_filter := format('(co.master_industry_id::text = any(%L) or co.master_industry_id is null)', p_industry_ids);
  else
    industry_filter := format('co.master_industry_id::text = any(%L)', p_industry_ids);
  end if;

  return query execute format($q$
    with pc as (
      select c.current_company_id as company_id, count(*)::bigint as n
      from public.contacts c
      where %s and (%L is null or c.country_normalized = %L)
        and c.current_company_id is not null
      group by c.current_company_id
    ),
    jc as (
      select j.company_id, count(*)::bigint as n
      from public.job_postings j
      where %s and j.is_active and j.company_id is not null
      group by j.company_id
    )
    select co.id,
           co.name,
           co.country_normalized,
           co.master_industry_id::text,
           mi.name_es,
           coalesce(pc.n, 0) as person_matches,
           coalesce(jc.n, 0) as job_matches,
           coalesce(pc.n, 0) + coalesce(jc.n, 0) as total_matches
    from public.companies co
    left join pc on pc.company_id = co.id
    left join jc on jc.company_id = co.id
    left join public.master_industries mi on mi.id = co.master_industry_id
    where (pc.company_id is not null or jc.company_id is not null)
      and (%L is null or co.country_normalized = %L)
      and %s
    order by total_matches desc
    limit %s
  $q$, contact_pred, p_country, p_country, job_pred, p_country, p_country, industry_filter, p_limit);
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Detalle: personas de UNA empresa que matchean el concepto, con evidencia.
--    Es el paso "personas bajo demanda". Devuelve identidad + el/los terminos que
--    matchearon (auditable, sin diccionario) + el snippet de donde salio, y los
--    datos de contacto crudos que ya estan en la tabla (email1/phone1).
-- -----------------------------------------------------------------------------
create or replace function v3.explore_company_people(
  p_like    text[],
  p_regex   text[],
  p_company_id uuid,
  p_limit   int default 25
) returns table (
  full_name text,
  current_position_title text,
  headline text,
  linkedin_url text,
  country_normalized text,
  matched_terms text[],
  email1 text,
  phone1 text
)
language plpgsql
stable
as $$
declare
  pred text := v3._explore_predicate(
    'c',
    array['headline','about','current_position_title','current_position_description'],
    p_like, p_regex
  );
  -- Para "que termino matcheo cada persona" se evalua cada termino regex contra
  -- los campos de texto y se arma el array de los que dieron true.
  matched_expr text := '';
  t text;
  parts text[] := '{}';
begin
  if p_regex is null or array_length(p_regex, 1) is null then
    matched_expr := 'array[]::text[]';
  else
    foreach t in array p_regex loop
      parts := parts || format(
        'case when (c.headline ~* %L or c.about ~* %L or c.current_position_title ~* %L or c.current_position_description ~* %L) then %L end',
        '\y'||t||'\y', '\y'||t||'\y', '\y'||t||'\y', '\y'||t||'\y', t
      );
    end loop;
    matched_expr := 'array_remove(array[' || array_to_string(parts, ',') || '], null)';
  end if;

  return query execute format($q$
    select c.full_name,
           c.current_position_title,
           c.headline,
           c.linkedin_url,
           c.country_normalized,
           %s as matched_terms,
           c.email1,
           c.phone1
    from public.contacts c
    where c.current_company_id = %L and %s
    order by (c.email1 is not null) desc, c.full_name
    limit %s
  $q$, matched_expr, p_company_id, pred, p_limit);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Permisos. El MCP corre con service_role (admin client). Se le da EXECUTE a
--    service_role y se REVOCA de PUBLIC/anon/authenticated.
--    OJO (verificado en este proyecto): en Supabase un REVOKE a PUBLIC NO le
--    quita EXECUTE a anon; hay que revocar explicitamente de anon y authenticated.
-- -----------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'v3._explore_predicate(text, text[], text[], text[])',
    'v3.explore_geo_facets(text[], text[], int)',
    'v3.explore_industry_facets(text[], text[], text, int)',
    'v3.explore_search_companies(text[], text[], text, text[], boolean, boolean, boolean, int)',
    'v3.explore_company_people(text[], text[], uuid, int)'
  ]
  loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('revoke all on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;

grant usage on schema v3 to service_role;
grant all on table v3.explore_sessions to service_role;
