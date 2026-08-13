-- =============================================================================
-- MCP Perfiles (tercer MCP, persona-first). Busqueda de TALENTO / perfiles.
--
-- Los otros dos MCP son empresa-first. Este invierte el eje: el usuario busca
-- PERSONAS por tecnologia/proceso/skill + experiencia de industria (+ pais +
-- cargo) sobre la tabla CRUDA de contactos, y quiere el contacto PERSONAL (mail
-- y telefono) para llegarle directo, no a traves del empleador.
--
-- Regla de oro del proyecto: v2 esta en produccion y no se puede romper. Esta
-- migracion NO crea, altera ni indexa NINGUNA tabla de v2. Solo agrega objetos
-- nuevos en el schema v3 que LEEN v2, y reusa objetos existentes:
--   - public.is_personal_email(...)        (heuristica de dominio personal)
--   - public.contacts_prevpos_text(jsonb)  (extrae titulo+descripcion de los
--     puestos ANTERIORES; ya viene con indice GIN trigram idx_contacts_prevpos_trgm)
--   - los 4 indices GIN trigram de public.contacts (headline, about,
--     current_position_title, current_position_description).
--
-- DISENO (v2), sobre 3 aprendizajes medidos contra la base real:
--
--  A. HISTORIAL. La v1 solo miraba el puesto ACTUAL (headline, about, titulo y
--     descripcion actuales) y se perdia ~21.500 perfiles que mencionan una
--     tecnologia solo en su experiencia PASADA. Ahora, con p_include_past=true,
--     se suma como 5ta "columna" la expresion indexada
--     public.contacts_prevpos_text(previous_positions), asi el planner usa
--     idx_contacts_prevpos_trgm y no hace seq scan.
--
--  B. GRUPOS AND. Una nube de terminos es un OR (sinonimos de UN concepto:
--     SAP, S/4HANA, ABAP...). Para "SAP Y experiencia en energia" o "full stack Y
--     SQL Y .NET" hacen falta VARIOS requisitos ANDeados. p_groups es un array de
--     grupos: dentro de cada grupo OR, entre grupos AND. Ademas de precision, esto
--     da PERFORMANCE: el planner hace BitmapAnd de los indices de cada grupo e
--     interseca ANTES de tocar el heap (medido: "SAP" solo = 14s / 42k filas;
--     "SAP" AND "energia" = 3,1s / 4k filas). El termino amplio SOLO es el unico
--     caso lento; por eso el MCP guia a sumar un segundo requisito o a acotar por
--     pais/industria.
--
--  C. TOKENS CON SIMBOLOS. El refinado por limite de palabra \yTERM\y rompia con
--     .NET / C# / C++ (el simbolo inicial/final no es "palabra"): .NET pasaba de
--     7007 matches a 2086. Ahora las anclas \y se agregan del lado de la app SOLO
--     del lado que empieza/termina en caracter de palabra, asi .NET matchea bien.
--     El SQL recibe el regex YA anclado y no vuelve a envolver.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: predicado de UN grupo (OR interno) sobre una lista de EXPRESIONES de
-- columna. A diferencia de v3._explore_predicate:
--   - Recibe EXPRESIONES ya calificadas (ej 'public.contacts_prevpos_text(c.previous_positions)'),
--     no nombres de columna, para poder incluir el historial.
--   - NO agrega \y: el regex llega ya anclado desde la app (fix C). Los terminos
--     entran como datos via %L (sin inyeccion); las expresiones son constantes del
--     server, nunca input del usuario.
-- -----------------------------------------------------------------------------
create or replace function v3._profiles_group_predicate(
  p_col_exprs text[],
  p_like  text[],
  p_regex text[]
) returns text
language plpgsql
immutable
as $$
declare
  expr text;
  t    text;
  like_ors  text[] := '{}';
  regex_ors text[] := '{}';
begin
  -- Sin terminos el grupo no filtra nada: 'false' para no devolver toda la tabla.
  if p_like is null or array_length(p_like, 1) is null then
    return 'false';
  end if;
  foreach expr in array p_col_exprs loop
    foreach t in array p_like loop
      like_ors := like_ors || format('%s ILIKE %L', expr, t);
    end loop;
    foreach t in array p_regex loop
      regex_ors := regex_ors || format('%s ~* %L', expr, t);
    end loop;
  end loop;
  return '(' || array_to_string(like_ors, ' OR ') || ') AND ('
             || array_to_string(regex_ors, ' OR ') || ')';
end;
$$;

-- -----------------------------------------------------------------------------
-- Busqueda de personas persona-first (v2).
--
-- p_groups: jsonb array. Cada elemento es {"raw":[...],"like":[...],"regex":[...]}:
--   - raw:   terminos crudos, para la evidencia matched_terms.
--   - like:  terminos envueltos en % y escapados, para el ILIKE indexable.
--   - regex: terminos YA anclados (\y donde corresponde) y regex-escapados.
-- Todos los grupos se ANDean; dentro de un grupo, OR. Sin grupos -> TERMS_REQUIRED
-- (nunca se escanea la tabla entera).
-- -----------------------------------------------------------------------------
create or replace function v3.profiles_search_people(
  p_groups jsonb,
  p_country text default null,
  p_industry_ids text[] default null,
  p_include_unclassified boolean default true,
  -- Buscar tambien en los puestos ANTERIORES (5ta columna indexada). true por
  -- defecto: "experiencia en X" incluye el pasado. false = solo puesto actual
  -- (mas rapido, y util para "quien trabaja con X HOY").
  p_include_past boolean default true,
  -- Filtro OPCIONAL por cargo/seniority: solo sobre titulo + headline ACTUALES.
  p_title_like  text[] default null,
  p_title_regex text[] default null,
  p_only_contactable boolean default false,
  p_limit  int default 25,
  p_offset int default 0
) returns table (
  contact_id text,
  full_name text,
  current_position_title text,
  headline text,
  linkedin_url text,
  country_normalized text,
  company_id text,
  company_name text,
  master_industry_id text,
  industry_name_es text,
  matched_terms text[],
  personal_email text,
  email_is_personal boolean,
  work_email text,
  personal_phone text,
  personal_phone_type text,
  phone_alt text,
  phone_alt_type text
)
language plpgsql
stable
as $$
declare
  base_cols text[] := array[
    'c.headline', 'c.about', 'c.current_position_title', 'c.current_position_description'
  ];
  col_exprs text[];
  grp jsonb;
  g_like text[];
  g_regex text[];
  g_raw text[];
  group_preds text[] := '{}';
  content_pred text;
  title_pred text;
  industry_filter text;
  -- Expresion booleana "tiene algun dato de contacto?": se usa para ORDENAR
  -- (contactables primero) y, si p_only_contactable, tambien para filtrar.
  contactable_expr text := $c$(coalesce(c.email1,'')<>'' or coalesce(c.email2,'')<>'' or coalesce(c.email3,'')<>'' or coalesce(c.email4,'')<>'' or coalesce(c.phone1,'')<>'' or coalesce(c.phone2,'')<>'')$c$;
  contactable_filter text;
  all_raw text[] := '{}';
  all_regex text[] := '{}';
  matched_expr text;
  i int;
  cond text;
  parts text[] := '{}';
begin
  if p_groups is null or jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) = 0 then
    raise exception 'TERMS_REQUIRED:Pasá al menos un grupo de términos (concepto) para buscar.';
  end if;

  -- Historial como 5ta columna (indexada). Es lo que recupera a los perfiles con
  -- experiencia pasada; sin esto se perdian ~21.500 en SAP.
  col_exprs := case
    when p_include_past then base_cols || array['public.contacts_prevpos_text(c.previous_positions)']
    else base_cols
  end;

  -- Un predicado por grupo; todos ANDeados. all_raw/all_regex juntan los terminos
  -- de todos los grupos para la evidencia matched_terms.
  for grp in select value from jsonb_array_elements(p_groups) loop
    g_like  := array(select jsonb_array_elements_text(grp->'like'));
    g_regex := array(select jsonb_array_elements_text(grp->'regex'));
    g_raw   := array(select jsonb_array_elements_text(grp->'raw'));
    if array_length(g_like, 1) is null then
      continue;
    end if;
    group_preds := group_preds || v3._profiles_group_predicate(col_exprs, g_like, g_regex);
    all_raw := all_raw || g_raw;
    all_regex := all_regex || g_regex;
  end loop;

  if array_length(group_preds, 1) is null then
    raise exception 'TERMS_REQUIRED:Ningún grupo trajo términos válidos (mínimo 3 caracteres, o 2 con símbolo).';
  end if;
  content_pred := '(' || array_to_string(group_preds, ') AND (') || ')';

  -- Cargo/seniority: opcional, SOLO titulo + headline actuales (un "Manager" en el
  -- about no lo hace manager). Mismo helper.
  title_pred := case
    when p_title_like is null or array_length(p_title_like, 1) is null then 'true'
    else v3._profiles_group_predicate(array['c.current_position_title', 'c.headline'], p_title_like, p_title_regex)
  end;

  -- Industria de la empresa ACTUAL de la persona (misma semantica que Explore).
  if p_industry_ids is null or array_length(p_industry_ids, 1) is null then
    industry_filter := 'true';
  elsif p_include_unclassified then
    industry_filter := format('(co.master_industry_id::text = any(%L) or co.master_industry_id is null)', p_industry_ids);
  else
    industry_filter := format('co.master_industry_id::text = any(%L)', p_industry_ids);
  end if;

  contactable_filter := case when p_only_contactable then contactable_expr else 'true' end;

  -- matched_terms: por cada termino (de cualquier grupo), si alguna de las
  -- columnas (incl. historial si aplica) lo matchea, se lista el termino crudo.
  if array_length(all_regex, 1) is null then
    matched_expr := 'array[]::text[]';
  else
    for i in 1 .. array_length(all_regex, 1) loop
      cond := (select string_agg(format('%s ~* %L', expr, all_regex[i]), ' or ') from unnest(col_exprs) as u(expr));
      parts := parts || format('case when (%s) then %L end', cond, all_raw[i]);
    end loop;
    matched_expr := 'array_remove(array[' || array_to_string(parts, ',') || '], null)';
  end if;

  -- DOS FASES (clave de performance):
  --   Fase 1 (hits): WHERE + ORDER BY + LIMIT/OFFSET trayendo SOLO columnas
  --     baratas (id, nombre, flag contactable). Aca esta el costo de matching
  --     (bitmap + recheck), pero NO se calcula nada caro por fila.
  --   Fase 2: sobre las <=limit filas de hits, recien se calculan matched_terms
  --     (que recomputa contacts_prevpos_text) y las subconsultas de mail/telefono.
  -- Sin esto, esas expresiones se evaluaban para TODAS las filas que matchean
  -- antes del LIMIT (medido: 3 grupos = 17,7s; con dos fases baja a segundos).
  return query execute format($q$
    with hits as (
      select c.id as cid, c.full_name as fname, %s as contactable
      from public.contacts c
      left join public.companies co on co.id = c.current_company_id
      where (%s)
        and (%L is null or c.country_normalized = %L)
        and (%s)   -- cargo (opcional)
        and (%s)   -- industria
        and (%s)   -- contactable (opcional)
      order by contactable desc, fname
      limit %s offset %s
    )
    select
      c.id::text,
      c.full_name,
      c.current_position_title,
      c.headline,
      c.linkedin_url,
      c.country_normalized,
      co.id::text,
      co.name,
      co.master_industry_id::text,
      mi.name_es,
      %s as matched_terms,
      (select em.email
         from (values (1, c.email1), (2, c.email2), (3, c.email3), (4, c.email4)) em(ord, email)
        where coalesce(em.email, '') <> '' and public.is_personal_email(em.email)
        order by em.ord limit 1) as personal_email,
      exists (
        select 1 from (values (c.email1), (c.email2), (c.email3), (c.email4)) e(email)
         where coalesce(e.email, '') <> '' and public.is_personal_email(e.email)
      ) as email_is_personal,
      (select em.email
         from (values (1, c.email1), (2, c.email2), (3, c.email3), (4, c.email4)) em(ord, email)
        where coalesce(em.email, '') <> '' and not public.is_personal_email(em.email)
        order by em.ord limit 1) as work_email,
      (select ph.phone
         from (values (1, c.phone1, c.phone1_type), (2, c.phone2, c.phone2_type)) ph(ord, phone, ptype)
        where coalesce(ph.phone, '') <> ''
        order by (coalesce(ph.ptype, '') ~* '(mobile|cell|personal|m[oó]vil|celular)') desc, ph.ord
        limit 1) as personal_phone,
      (select ph.ptype
         from (values (1, c.phone1, c.phone1_type), (2, c.phone2, c.phone2_type)) ph(ord, phone, ptype)
        where coalesce(ph.phone, '') <> ''
        order by (coalesce(ph.ptype, '') ~* '(mobile|cell|personal|m[oó]vil|celular)') desc, ph.ord
        limit 1) as personal_phone_type,
      (select ph.phone
         from (values (1, c.phone1, c.phone1_type), (2, c.phone2, c.phone2_type)) ph(ord, phone, ptype)
        where coalesce(ph.phone, '') <> ''
        order by (coalesce(ph.ptype, '') ~* '(mobile|cell|personal|m[oó]vil|celular)') desc, ph.ord
        offset 1 limit 1) as phone_alt,
      (select ph.ptype
         from (values (1, c.phone1, c.phone1_type), (2, c.phone2, c.phone2_type)) ph(ord, phone, ptype)
        where coalesce(ph.phone, '') <> ''
        order by (coalesce(ph.ptype, '') ~* '(mobile|cell|personal|m[oó]vil|celular)') desc, ph.ord
        offset 1 limit 1) as phone_alt_type
    from hits h
    join public.contacts c on c.id = h.cid
    left join public.companies co on co.id = c.current_company_id
    left join public.master_industries mi on mi.id = co.master_industry_id
    order by h.contactable desc, h.fname
  $q$,
    contactable_expr,
    content_pred,
    p_country, p_country,
    title_pred,
    industry_filter,
    contactable_filter,
    p_limit, p_offset,
    matched_expr
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Permisos: EXECUTE solo para service_role, revocado de public/anon/authenticated.
-- -----------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'v3._profiles_group_predicate(text[], text[], text[])',
    'v3.profiles_search_people(jsonb, text, text[], boolean, boolean, text[], text[], boolean, int, int)'
  ]
  loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('revoke all on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
