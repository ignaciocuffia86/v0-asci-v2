-- =============================================================================
-- MCP Perfiles (tercer MCP, persona-first). Para busqueda de TALENTO / perfiles.
--
-- Los otros dos MCP son empresa-first: "que empresas usan SAP" y, dentro de una
-- empresa, "quien sabe de esto". Este invierte el eje: el usuario busca PERSONAS
-- por tecnologia/proceso + experiencia de industria (+ pais + cargo) sobre la
-- tabla CRUDA de contactos, y lo que quiere es el dato de contacto PERSONAL
-- (mail y telefono) para llegarle directo, no a traves del empleador.
--
-- Regla de oro del proyecto: v2 esta en produccion y no se puede romper. Esta
-- migracion NO crea, altera ni indexa NINGUNA tabla de v2. Solo agrega UNA
-- funcion nueva en el schema v3 que LEE public.contacts / public.companies /
-- public.master_industries, y reusa objetos que ya existen:
--   - v3._explore_predicate(...)  (el predicado de texto index-friendly del MCP
--     Explore; misma tecnica ILIKE-trigram + refinado por limite de palabra).
--   - public.is_personal_email(...) (heuristica de dominio personal ya usada por
--     el export de bookmarks).
--
-- Las FACETAS de pais e industria del embudo persona-first NO se redefinen aca:
-- v3.explore_geo_facets y v3.explore_industry_facets ya cuentan PERSONAS por
-- termino y se reusan tal cual desde la capa de aplicacion. Este archivo agrega
-- solo lo que faltaba: la lista de PERSONAS global (no acotada a una empresa) con
-- el contacto personal resuelto.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Busqueda de personas persona-first.
--
-- Diferencia con v3.explore_company_people: aquella exige un company_id (detalle
-- dentro de UNA empresa). Esta busca en TODA la base, acotando por pais/industria
-- /cargo, que es el caso de un reclutador que arranca por la tecnologia.
--
-- Performance (misma logica que valido el MCP Explore contra la base real):
--   - El predicado de TERMINOS va primero y usa el indice GIN trigram de
--     public.contacts. Es el filtro mas selectivo; pais/industria/cargo NO tienen
--     indice y solo salen baratos DESPUES de que los terminos ya recortaron.
--   - Por eso los terminos son obligatorios (sin ellos el predicado es 'false' y
--     no se devuelve nada, en vez de escanear la tabla entera).
--   - El ORDER BY usa solo chequeos de columna baratos (hay dato de contacto?),
--     nunca las subconsultas de resolucion de mail/telefono.
--
-- Contacto PERSONAL (lo que pidio el caso de uso):
--   - personal_email: el primer email (email1..email4) cuyo dominio es personal
--     segun public.is_personal_email (gmail, hotmail, outlook, ...). Si no hay
--     ninguno personal, queda NULL y se expone work_email como fallback ETIQUETADO
--     (email_is_personal=false), para que el reclutador decida. Nunca se deja sin
--     ningun dato si hay alguno.
--   - personal_phone: se prioriza el telefono cuyo _type indica movil/personal
--     (mobile, cell, personal, movil, celular); si ninguno lo indica, gana phone1.
--     Los telefonos crudos no traen dominio, asi que el _type es la unica pista.
-- -----------------------------------------------------------------------------
create or replace function v3.profiles_search_people(
  p_like    text[],
  p_regex   text[],
  p_country text default null,
  p_industry_ids text[] default null,
  p_include_unclassified boolean default true,
  -- Filtro OPCIONAL por cargo/seniority: se aplica sobre title + headline. Si
  -- viene null, no filtra (no confundir con el predicado de concepto, que es
  -- obligatorio y corre sobre 4 columnas de texto).
  p_title_like  text[] default null,
  p_title_regex text[] default null,
  -- Si es true, solo devuelve personas con AL MENOS un dato de contacto (mail o
  -- telefono). Util cuando el reclutador solo quiere gente a la que puede llegar.
  p_only_contactable boolean default false,
  p_limit   int default 25,
  p_offset  int default 0
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
  -- Concepto: mismo helper y mismas 4 columnas que el MCP Explore.
  pred text := v3._explore_predicate(
    'c',
    array['headline','about','current_position_title','current_position_description'],
    p_like, p_regex
  );
  -- Cargo (opcional): solo si vino la lista; si no, no restringe.
  title_pred text := case
    when p_title_like is null or array_length(p_title_like, 1) is null then 'true'
    else v3._explore_predicate('c', array['current_position_title','headline'], p_title_like, p_title_regex)
  end;
  -- Industria de la empresa ACTUAL de la persona (misma semantica que el embudo
  -- de Explore). include_unclassified suma las empresas sin industria mapeada.
  industry_filter text;
  -- Datos de contacto: al menos un mail o telefono no vacio.
  contactable_filter text := case
    when p_only_contactable then $f$(
      coalesce(c.email1,'') <> '' or coalesce(c.email2,'') <> '' or
      coalesce(c.email3,'') <> '' or coalesce(c.email4,'') <> '' or
      coalesce(c.phone1,'') <> '' or coalesce(c.phone2,'') <> ''
    )$f$
    else 'true'
  end;
  -- "Que termino matcheo cada persona": mismo patron que explore_company_people.
  matched_expr text := '';
  t text;
  parts text[] := '{}';
begin
  if p_industry_ids is null or array_length(p_industry_ids, 1) is null then
    industry_filter := 'true';
  elsif p_include_unclassified then
    industry_filter := format('(co.master_industry_id::text = any(%L) or co.master_industry_id is null)', p_industry_ids);
  else
    industry_filter := format('co.master_industry_id::text = any(%L)', p_industry_ids);
  end if;

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
      -- Mail personal: primer email de dominio personal, por prioridad email1..4.
      (select em.email
         from (values (1, c.email1), (2, c.email2), (3, c.email3), (4, c.email4)) em(ord, email)
        where coalesce(em.email, '') <> '' and public.is_personal_email(em.email)
        order by em.ord
        limit 1) as personal_email,
      -- Flag: hay al menos un email personal? (si no, la capa de app cae al work).
      exists (
        select 1
          from (values (c.email1), (c.email2), (c.email3), (c.email4)) e(email)
         where coalesce(e.email, '') <> '' and public.is_personal_email(e.email)
      ) as email_is_personal,
      -- Fallback corporativo ETIQUETADO: primer email NO personal, por prioridad.
      (select em.email
         from (values (1, c.email1), (2, c.email2), (3, c.email3), (4, c.email4)) em(ord, email)
        where coalesce(em.email, '') <> '' and not public.is_personal_email(em.email)
        order by em.ord
        limit 1) as work_email,
      -- Telefono personal: se prioriza el de tipo movil/personal; si ninguno, phone1.
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
      -- El OTRO telefono (el que no gano), por si el reclutador quiere ambos.
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
    from public.contacts c
    left join public.companies co on co.id = c.current_company_id
    left join public.master_industries mi on mi.id = co.master_industry_id
    where %s
      and (%L is null or c.country_normalized = %L)
      and %s   -- cargo (opcional)
      and %s   -- industria
      and %s   -- contactable (opcional)
    order by
      -- Contactables primero: los que tienen algun mail o telefono son los utiles.
      ((coalesce(c.email1,'') <> '' or coalesce(c.email2,'') <> '' or
        coalesce(c.email3,'') <> '' or coalesce(c.email4,'') <> '' or
        coalesce(c.phone1,'') <> '' or coalesce(c.phone2,'') <> '')) desc,
      c.full_name
    limit %s offset %s
  $q$,
    matched_expr,
    pred,
    p_country, p_country,
    title_pred,
    industry_filter,
    contactable_filter,
    p_limit, p_offset
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Permisos. Igual que el resto de v3: EXECUTE solo para service_role (el admin
-- client con el que corre el MCP), revocado de public/anon/authenticated.
-- OJO (verificado en este proyecto): un REVOKE a PUBLIC NO le quita EXECUTE a
-- anon; hay que revocar explicitamente de anon y authenticated.
-- -----------------------------------------------------------------------------
do $$
declare fn text := 'v3.profiles_search_people(text[], text[], text, text[], boolean, text[], text[], boolean, int, int)';
begin
  execute format('revoke all on function %s from public', fn);
  execute format('revoke all on function %s from anon', fn);
  execute format('revoke all on function %s from authenticated', fn);
  execute format('grant execute on function %s to service_role', fn);
end;
$$;
