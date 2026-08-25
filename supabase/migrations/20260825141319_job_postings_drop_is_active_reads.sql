-- job_postings.is_active: dejar de leerlo.
--
-- La columna se creó con DEFAULT true (scripts/043) y NADIE la escribe: el INSERT del ETL no la
-- nombra, el ON CONFLICT (job_url) sólo pisa title/description/updated_at, los dos únicos UPDATE
-- que la tocan son los de merge de empresas (`SET is_active = m.is_active OR r.dup_active`, que
-- sólo puede subirla a true) y no hay triggers. Medido el 25-ago-2026 contra el catálogo real:
-- 43.052 filas en true, 0 en false, 0 en null, y la más vieja es de 2023-03-31.
--
-- Tampoco puede volverse cierta con el pipeline actual: el único proceso que revisita vacantes es
-- el cron v3-scrape-job-postings, que corre sobre cuentas seguidas (14 empresas, contra 6.822 con
-- vacantes en el catálogo) y en el refresh mensual va con windowDays 30 — o sea que trae novedades
-- y nunca vuelve a mirar una vacante vieja. "No apareció en la última corrida" no prueba nada.
--
-- Seis funciones la leían y ninguna filtraba nada; lo único que lograban era que el número se
-- leyera como "vacantes abiertas". Esta migración las saca. La columna QUEDA (el ETL sigue
-- escribiendo su default y borrarla es irreversible), pero con un COMMENT que dice que no se
-- mantiene, para que nadie vuelva a construir sobre ella.
--
-- Lo que está abierto HOY se responde con scrape_company_job_postings, que va a LinkedIn en el
-- momento. Ese es el único camino, y es el que documentan las tools del MCP.

-- ── search_companies_by_name_filtered — el conteo por empresa deja de fingir que filtra
CREATE OR REPLACE FUNCTION public.search_companies_by_name_filtered(p_query_text text, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, name text, logo_url text, country text, industry text, linkedin_url text, job_postings_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_normalized_query TEXT;
BEGIN
  -- Normalize the search input: lowercase + remove accents
  v_normalized_query := unaccent(LOWER(TRIM(p_query_text)));

  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.logo_url,
    c.country,
    c.industry,
    c.linkedin_url,
    -- Vacantes de la empresa en TODO el histórico. El filtro por jp.is_active que había acá
    -- no descartaba nada (la columna está en true en las 43.052 filas) y hacía leer el número
    -- como "vacantes abiertas".
    (SELECT COUNT(*) FROM job_postings jp WHERE jp.company_id = c.id)::bigint AS job_postings_count
  FROM
    companies c
  WHERE
    c.normalized_name ILIKE '%' || v_normalized_query || '%'
    AND c.linkedin_url IS NOT NULL
    AND c.linkedin_url != ''
    AND EXISTS (
      SELECT 1 FROM signals s WHERE s.company_id = c.id
    )
  ORDER BY
    CASE WHEN c.normalized_name ILIKE v_normalized_query || '%' THEN 0 ELSE 1 END,
    length(c.name)
  LIMIT p_limit;
END;
$function$
;

-- ── get_bookmark_export_data — se va el filtro no-op y el campo is_active del payload
CREATE OR REPLACE FUNCTION public.get_bookmark_export_data(p_bookmark_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_company_id UUID;
  v_search_context JSONB;
  v_filter_signal_ids UUID[];
  v_has_scope_filter BOOLEAN;
  v_result JSONB;
BEGIN
  SELECT company_id, search_context
  INTO v_company_id, v_search_context
  FROM bookmarks
  WHERE id = p_bookmark_id AND user_id = p_user_id;

  IF v_company_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT ARRAY(
    SELECT elem::UUID
    FROM jsonb_array_elements_text(
      COALESCE(v_search_context->'filterSignalIds', '[]'::jsonb)
    ) AS elem
    WHERE elem IS NOT NULL AND elem != ''
  ) INTO v_filter_signal_ids;

  v_has_scope_filter := (
    array_length(v_filter_signal_ids, 1) IS NOT NULL
    AND array_length(v_filter_signal_ids, 1) > 0
  );

  SELECT jsonb_build_object(

    'company', (
      SELECT jsonb_build_object(
        'name', c.name,
        'country', c.country_normalized,
        'industry', c.industry,
        'website', c.website,
        'linkedin_url', c.linkedin_url,
        'employee_count', NULL
      )
      FROM companies c
      WHERE c.id = v_company_id
    ),

    'bookmark', (
      SELECT jsonb_build_object(
        'status', b.status,
        'priority', b.priority,
        'notes', b.notes,
        'search_context', b.search_context,
        'created_at', b.created_at
      )
      FROM bookmarks b
      WHERE b.id = p_bookmark_id
    ),

    'strategy', (
      SELECT jsonb_build_object(
        'recommended_pitch', ucs.recommended_pitch,
        'sender_context_override', ucs.sender_context_override
      )
      FROM user_company_strategies ucs
      WHERE ucs.bookmark_id = p_bookmark_id AND ucs.user_id = p_user_id
    ),

    -- Empleados con senales: exponemos TODOS los slots de email (1..4) y phone
    -- (1..2) con tipo y status para que el usuario pueda priorizar en Excel.
    'employees_with_signals', COALESCE((
      SELECT jsonb_agg(emp_row ORDER BY (emp_row->>'signal_count')::int DESC NULLS LAST)
      FROM (
        SELECT DISTINCT ON (ct.id) jsonb_build_object(
          'first_name', ct.first_name,
          'last_name', ct.last_name,
          'position', ct.current_position_title,
          'linkedin_url', ct.linkedin_url,

          -- Slot 1 de email
          'email1', ct.email1,
          'email1_type', ct.email1_type,
          'email1_status', ct.email1_status,

          -- Slot 2 de email
          'email2', ct.email2,
          'email2_type', ct.email2_type,
          'email2_status', ct.email2_status,

          -- Slot 3 de email
          'email3', ct.email3,
          'email3_type', ct.email3_type,
          'email3_status', ct.email3_status,

          -- Slot 4 de email
          'email4', ct.email4,
          'email4_type', ct.email4_type,
          'email4_status', ct.email4_status,

          -- Slot 1 de telefono
          'phone1', ct.phone1,
          'phone1_type', ct.phone1_type,
          'phone1_status', ct.phone1_status,

          -- Slot 2 de telefono
          'phone2', ct.phone2,
          'phone2_type', ct.phone2_type,
          'phone2_status', ct.phone2_status,

          'signal_count', (
            SELECT COUNT(*)
            FROM signals s
            WHERE s.contact_id = ct.id
              AND s.is_current_employee = true
              AND (NOT v_has_scope_filter OR s.signal_id = ANY(v_filter_signal_ids))
          ),
          'signals', (
            SELECT jsonb_agg(jsonb_build_object(
              'signal_type', s.signal_type,
              'signal_name', COALESCE(dp.name, dpr.name, s.keyword_matched),
              'source', s.source_field,
              'snippet', LEFT(s.snippet, 200)
            ))
            FROM signals s
            LEFT JOIN dictionary_products dp ON dp.id = s.signal_id AND s.signal_type = 'technology'
            LEFT JOIN dictionary_processes dpr ON dpr.id = s.signal_id AND s.signal_type = 'process'
            WHERE s.contact_id = ct.id
              AND s.is_current_employee = true
              AND (NOT v_has_scope_filter OR s.signal_id = ANY(v_filter_signal_ids))
          )
        ) AS emp_row
        FROM contacts ct
        WHERE ct.current_company_id = v_company_id
          AND EXISTS (
            SELECT 1 FROM signals sig
            WHERE sig.contact_id = ct.id
              AND sig.is_current_employee = true
              AND (NOT v_has_scope_filter OR sig.signal_id = ANY(v_filter_signal_ids))
          )
      ) sub
      WHERE (emp_row->>'signal_count')::int > 0
    ), '[]'::jsonb),

    'job_postings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'title', jp.title,
        'url', jp.job_url,
        'location', jp.location,
        'posted_at', jp.posted_at,
        'signals', (
          SELECT jsonb_agg(jsonb_build_object(
            'signal_type', s.signal_type,
            'signal_name', COALESCE(dp.name, dpr.name, s.keyword_matched)
          ))
          FROM signals s
          LEFT JOIN dictionary_products dp ON dp.id = s.signal_id AND s.signal_type = 'technology'
          LEFT JOIN dictionary_processes dpr ON dpr.id = s.signal_id AND s.signal_type = 'process'
          WHERE s.job_posting_id = jp.id
            AND (NOT v_has_scope_filter OR s.signal_id = ANY(v_filter_signal_ids))
        )
      ) ORDER BY jp.posted_at DESC NULLS LAST)
      FROM job_postings jp
      -- Sin filtro por jp.is_active: no descartaba nada y el payload salía marcando
      -- como activas vacantes de 2023.
      WHERE jp.company_id = v_company_id
        AND EXISTS (
          SELECT 1 FROM signals sig
          WHERE sig.job_posting_id = jp.id
            AND (NOT v_has_scope_filter OR sig.signal_id = ANY(v_filter_signal_ids))
        )
    ), '[]'::jsonb),

    'prospects', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'first_name', ucc.first_name,
        'last_name', ucc.last_name,
        'headline', ucc.headline,
        'email', ucc.email,
        'email_status', ucc.email_status,
        'linkedin_url', ucc.linkedin_url,
        'mobile_phone', ucc.mobile_phone,
        'phone', ucc.phone,
        'seniority', ucc.seniority,
        'is_decision_maker', ucc.is_decision_maker,
        'departments', ucc.departments
      ) ORDER BY ucc.is_decision_maker DESC NULLS LAST, ucc.seniority)
      FROM user_company_contacts ucc
      WHERE ucc.company_id = v_company_id AND ucc.user_id = p_user_id
    ), '[]'::jsonb),

    'news', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'title', cn.title,
        'url', cn.source_url,
        'published_at', cn.published_at,
        'source', cn.source_name
      ) ORDER BY cn.published_at DESC NULLS LAST)
      FROM company_news cn
      WHERE cn.company_id = v_company_id
      LIMIT 10
    ), '[]'::jsonb),

    'implementations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_name', ci.technology,
        'vendor_name', ci.provider_name,
        'category', ci.area,
        'source_url', ci.source_url
      ))
      FROM company_implementations ci
      WHERE ci.company_id = v_company_id
    ), '[]'::jsonb)

  ) INTO v_result;

  RETURN v_result;
END;
$function$
;

-- ── export_job_postings — se cae el parámetro p_only_active y la columna is_active
DROP FUNCTION IF EXISTS public.export_job_postings(text, text[], text[], text[], date, date, text, text, boolean, boolean, boolean, integer, integer);
CREATE OR REPLACE FUNCTION public.export_job_postings(p_signal_type text DEFAULT NULL::text, p_signal_names text[] DEFAULT NULL::text[], p_countries text[] DEFAULT NULL::text[], p_industries text[] DEFAULT NULL::text[], p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_location_query text DEFAULT NULL::text, p_title_query text DEFAULT NULL::text, p_only_with_signals boolean DEFAULT false, p_include_description boolean DEFAULT false, p_limit integer DEFAULT 1000, p_offset integer DEFAULT 0)
 RETURNS TABLE(job_id uuid, title text, company_name text, country text, industry text, location text, posted_at timestamp with time zone, job_url text, apply_url text, signal_count bigint, signals_process text, signals_technology text, description text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '55s'
AS $function$
DECLARE
  v_signal_ids uuid[];
  v_filter_signals boolean;
BEGIN
  v_filter_signals := p_signal_names IS NOT NULL
                      AND array_length(p_signal_names, 1) > 0;

  IF v_filter_signals THEN
    SELECT array_agg(id) INTO v_signal_ids
    FROM (
      SELECT id FROM dictionary_processes
        WHERE name = ANY(p_signal_names)
          AND (p_signal_type IS NULL OR p_signal_type = 'process')
      UNION ALL
      SELECT id FROM dictionary_products
        WHERE name = ANY(p_signal_names)
          AND (p_signal_type IS NULL OR p_signal_type = 'technology')
    ) d;
    v_signal_ids := COALESCE(v_signal_ids, '{}'::uuid[]);
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      j.id, j.title, j.location, j.posted_at,
      j.job_url, j.apply_url, j.description,
      c.name AS c_name,
      c.country_normalized AS c_country,
      c.industry AS c_industry
    FROM job_postings j
    LEFT JOIN companies c ON c.id = j.company_id
    WHERE (p_date_from IS NULL OR j.posted_at >= p_date_from::timestamptz)
      AND (p_date_to IS NULL OR j.posted_at < (p_date_to + 1)::timestamptz)
      AND (p_countries IS NULL OR c.country_normalized = ANY(p_countries))
      AND (p_industries IS NULL OR c.industry = ANY(p_industries))
      AND (p_location_query IS NULL OR j.location ILIKE '%' || p_location_query || '%')
      AND (p_title_query IS NULL OR j.title ILIKE '%' || p_title_query || '%')
      AND (
        NOT v_filter_signals
        OR EXISTS (
          SELECT 1 FROM signals s
          WHERE s.job_posting_id = j.id
            AND s.signal_id = ANY(v_signal_ids)
            AND (p_signal_type IS NULL OR s.signal_type = p_signal_type)
        )
      )
      AND (
        NOT p_only_with_signals
        OR EXISTS (SELECT 1 FROM signals s2 WHERE s2.job_posting_id = j.id)
      )
  )
  SELECT
    b.id AS job_id,
    b.title::TEXT,
    b.c_name::TEXT AS company_name,
    b.c_country::TEXT AS country,
    b.c_industry::TEXT AS industry,
    b.location::TEXT,
    b.posted_at,
    b.job_url::TEXT,
    b.apply_url::TEXT,
    COALESCE(sg.cnt, 0)::BIGINT AS signal_count,
    sg.procs AS signals_process,
    sg.techs AS signals_technology,
    CASE WHEN p_include_description THEN b.description::TEXT ELSE NULL END AS description
  FROM base b
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::BIGINT AS cnt,
      NULLIF(string_agg(DISTINCT dpr.name, '; '), '') AS procs,
      NULLIF(string_agg(DISTINCT dp.name, '; '), '') AS techs
    FROM signals s
    LEFT JOIN dictionary_processes dpr
      ON dpr.id = s.signal_id AND s.signal_type = 'process'
    LEFT JOIN dictionary_products dp
      ON dp.id = s.signal_id AND s.signal_type = 'technology'
    WHERE s.job_posting_id = b.id
  ) sg ON TRUE
  ORDER BY b.posted_at DESC NULLS LAST, b.id
  LIMIT p_limit OFFSET p_offset;
END;
$function$
;

-- ── export_job_postings_count — mismo parámetro, misma suerte
DROP FUNCTION IF EXISTS public.export_job_postings_count(text, text[], text[], text[], date, date, text, text, boolean, boolean);
CREATE OR REPLACE FUNCTION public.export_job_postings_count(p_signal_type text DEFAULT NULL::text, p_signal_names text[] DEFAULT NULL::text[], p_countries text[] DEFAULT NULL::text[], p_industries text[] DEFAULT NULL::text[], p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_location_query text DEFAULT NULL::text, p_title_query text DEFAULT NULL::text, p_only_with_signals boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '55s'
AS $function$
DECLARE
  v_signal_ids uuid[];
  v_filter_signals boolean;
  v_total bigint;
BEGIN
  v_filter_signals := p_signal_names IS NOT NULL
                      AND array_length(p_signal_names, 1) > 0;

  IF v_filter_signals THEN
    SELECT array_agg(id) INTO v_signal_ids
    FROM (
      SELECT id FROM dictionary_processes
        WHERE name = ANY(p_signal_names)
          AND (p_signal_type IS NULL OR p_signal_type = 'process')
      UNION ALL
      SELECT id FROM dictionary_products
        WHERE name = ANY(p_signal_names)
          AND (p_signal_type IS NULL OR p_signal_type = 'technology')
    ) d;
    v_signal_ids := COALESCE(v_signal_ids, '{}'::uuid[]);
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM job_postings j
  LEFT JOIN companies c ON c.id = j.company_id
  WHERE (p_date_from IS NULL OR j.posted_at >= p_date_from::timestamptz)
    AND (p_date_to IS NULL OR j.posted_at < (p_date_to + 1)::timestamptz)
    AND (p_countries IS NULL OR c.country_normalized = ANY(p_countries))
    AND (p_industries IS NULL OR c.industry = ANY(p_industries))
    AND (p_location_query IS NULL OR j.location ILIKE '%' || p_location_query || '%')
    AND (p_title_query IS NULL OR j.title ILIKE '%' || p_title_query || '%')
    AND (
      NOT v_filter_signals
      OR EXISTS (
        SELECT 1 FROM signals s
        WHERE s.job_posting_id = j.id
          AND s.signal_id = ANY(v_signal_ids)
          AND (p_signal_type IS NULL OR s.signal_type = p_signal_type)
      )
    )
    AND (
      NOT p_only_with_signals
      OR EXISTS (SELECT 1 FROM signals s2 WHERE s2.job_posting_id = j.id)
    );

  RETURN COALESCE(v_total, 0);
END;
$function$
;

-- ── export_job_postings_stats — se va 'active_jobs', que siempre era igual a total_jobs
CREATE OR REPLACE FUNCTION public.export_job_postings_stats()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '45s'
AS $function$
  SELECT jsonb_build_object(
    'total_jobs',       (SELECT COUNT(*) FROM job_postings),
    'with_signals',     (SELECT COUNT(DISTINCT job_posting_id) FROM signals WHERE job_posting_id IS NOT NULL),
    'with_country',     (SELECT COUNT(*) FROM job_postings j JOIN companies c ON c.id = j.company_id
                          WHERE c.country_normalized IS NOT NULL AND c.country_normalized <> ''),
    'companies',        (SELECT COUNT(DISTINCT company_id) FROM job_postings WHERE company_id IS NOT NULL),
    'date_min',         (SELECT MIN(posted_at)::date FROM job_postings),
    'date_max',         (SELECT MAX(posted_at)::date FROM job_postings)
  );
$function$
;

-- ── v3.explore_search_companies — jobMatches deja de pasar por un filtro que no filtra
CREATE OR REPLACE FUNCTION v3.explore_search_companies(p_like text[], p_regex text[], p_country text DEFAULT NULL::text, p_industry_ids text[] DEFAULT NULL::text[], p_include_unclassified boolean DEFAULT true, p_search_contacts boolean DEFAULT true, p_search_jobs boolean DEFAULT true, p_limit integer DEFAULT 25)
 RETURNS TABLE(company_id uuid, company_name text, country_normalized text, master_industry_id text, industry_name_es text, person_matches bigint, job_matches bigint, total_matches bigint)
 LANGUAGE plpgsql
 STABLE
AS $function$
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
      -- Sin `and j.is_active`: viene en true en todas las filas, así que jobMatches
      -- contaba lo mismo con o sin el filtro.
      where %s and j.company_id is not null
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
$function$
;

-- ── Permisos de las dos funciones recreadas
--
-- El DROP se lleva la ACL y el CREATE vuelve a dejar el EXECUTE por defecto de PUBLIC, que
-- incluye a `anon`. Estas dos son SECURITY DEFINER (saltean RLS), y hoy están sólo en
-- authenticated + service_role justamente porque 20250101000001 revocó ese default. Se repite
-- acá sobre las firmas nuevas para no reabrir el agujero al recrearlas.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('export_job_postings', 'export_job_postings_count')
  loop
    execute format('revoke execute on function %s from anon', r.sig);
    execute format('revoke execute on function %s from public', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;

-- ── La columna queda, pero documentada como lo que es
COMMENT ON COLUMN public.job_postings.is_active IS
  'NO SE MANTIENE. Se escribe con el DEFAULT true en la ingesta y ningún proceso la vuelve a tocar: '
  'al 25-ago-2026 está en true en las 43.052 filas, incluidas vacantes de 2023. No la uses para '
  'filtrar ni para decir que una búsqueda sigue abierta; para eso está scrape_company_job_postings, '
  'que consulta LinkedIn en el momento.';
