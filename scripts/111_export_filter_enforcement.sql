-- scripts/111_export_filter_enforcement.sql
--
-- Cambios en la feature de export de bookmarks:
--   1. Crea helpers is_personal_email() y pick_best_email() para priorizar
--      el email corporativo sobre el personal cuando hay ambos.
--   2. Reemplaza get_bookmark_export_data para:
--      - Bloquear el export cuando search_context.filterSignalIds esta vacio:
--        retorna {"error":"NO_FILTER"} en lugar de data. Asi la capa de API
--        puede responder 400 con un mensaje claro.
--      - En employees_with_signals: usar pick_best_email(email1, email2).
--      - En prospects: incluir mobile_phone como campo separado ademas de phone.
--
-- Notas:
--   - La heuristica de email personal se basa en dominios gratuitos conocidos.
--     Si el dominio es personal, el corporativo gana aunque sea el email2.
--   - `user_company_contacts.email` (prospectos Apollo) NO se toca: Apollo ya
--     nos devuelve el email priorizado y la columna es unica.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_personal_email(p_email text)
returns boolean
language sql
immutable
as $$
  select case
    when p_email is null or position('@' in p_email) = 0 then false
    else lower(split_part(p_email, '@', 2)) in (
      'gmail.com',
      'googlemail.com',
      'hotmail.com',
      'hotmail.es',
      'hotmail.com.ar',
      'outlook.com',
      'outlook.es',
      'live.com',
      'live.com.ar',
      'msn.com',
      'yahoo.com',
      'yahoo.es',
      'yahoo.com.ar',
      'ymail.com',
      'icloud.com',
      'me.com',
      'mac.com',
      'aol.com',
      'proton.me',
      'protonmail.com',
      'pm.me',
      'gmx.com',
      'gmx.net',
      'mail.com',
      'yandex.com',
      'yandex.ru',
      'zoho.com',
      'fastmail.com',
      'tutanota.com',
      'hey.com'
    )
  end
$$;

-- Devuelve el "mejor" email entre dos candidatos, priorizando el corporativo.
-- Reglas:
--   - Si ambos son personales o ambos corporativos: gana el primero (email1).
--   - Si uno es corporativo y el otro personal: gana el corporativo.
--   - Si alguno es null: gana el otro.
create or replace function public.pick_best_email(p_email1 text, p_email2 text)
returns text
language sql
immutable
as $$
  select case
    when p_email1 is null and p_email2 is null then null
    when p_email1 is null then p_email2
    when p_email2 is null then p_email1
    when public.is_personal_email(p_email1) and not public.is_personal_email(p_email2)
      then p_email2
    else p_email1
  end
$$;

-- ---------------------------------------------------------------------------
-- RPC: get_bookmark_export_data
-- ---------------------------------------------------------------------------

create or replace function public.get_bookmark_export_data(
  p_bookmark_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_company_id uuid;
  v_search_context jsonb;
  v_filter_signal_ids uuid[];
  v_has_scope_filter boolean;
  v_result jsonb;
begin
  -- Validar ownership y traer contexto del bookmark
  select b.company_id, b.search_context
    into v_company_id, v_search_context
  from bookmarks b
  where b.id = p_bookmark_id
    and b.user_id = p_user_id;

  if v_company_id is null then
    return jsonb_build_object('error', 'NOT_FOUND');
  end if;

  -- Extraer filterSignalIds y chequear que haya al menos uno.
  -- Tratamos null / array vacio / campo ausente como "sin filtro".
  v_filter_signal_ids := coalesce(
    (
      select array_agg((value::text)::uuid)
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(v_search_context->'filterSignalIds') = 'array'
            then v_search_context->'filterSignalIds'
          else '[]'::jsonb
        end
      )
    ),
    '{}'::uuid[]
  );

  v_has_scope_filter := array_length(v_filter_signal_ids, 1) > 0;

  -- Gating: si no hay filtro aplicado, cortamos antes de escanear data.
  -- La capa HTTP detecta este error y responde 400 al cliente.
  if not v_has_scope_filter then
    return jsonb_build_object('error', 'NO_FILTER');
  end if;

  select jsonb_build_object(
    'company', (
      select jsonb_build_object(
        'name', c.name,
        'country', c.country_normalized,
        'industry', c.industry,
        'website', c.website,
        'linkedin_url', c.linkedin_url,
        'employee_count', null
      )
      from companies c
      where c.id = v_company_id
    ),

    'bookmark', (
      select jsonb_build_object(
        'status', b.status,
        'priority', b.priority,
        'notes', b.notes,
        'search_context', b.search_context,
        'created_at', b.created_at
      )
      from bookmarks b
      where b.id = p_bookmark_id
    ),

    'strategy', (
      select jsonb_build_object(
        'recommended_pitch', ucs.recommended_pitch,
        'sender_context_override', ucs.sender_context_override
      )
      from user_company_strategies ucs
      where ucs.bookmark_id = p_bookmark_id and ucs.user_id = p_user_id
    ),

    -- Employees: solo contactos con al menos una señal en el filtro
    'employees_with_signals', coalesce((
      select jsonb_agg(emp_row order by (emp_row->>'signal_count')::int desc nulls last)
      from (
        select distinct on (ct.id) jsonb_build_object(
          'first_name', ct.first_name,
          'last_name', ct.last_name,
          'position', ct.current_position_title,
          -- Priorizar email corporativo sobre personal
          'email', public.pick_best_email(ct.email1, ct.email2),
          'linkedin_url', ct.linkedin_url,
          'signal_count', (
            select count(*)
            from signals s
            where s.contact_id = ct.id
              and s.is_current_employee = true
              and s.signal_id = any(v_filter_signal_ids)
          ),
          'signals', (
            select jsonb_agg(jsonb_build_object(
              'signal_type', s.signal_type,
              'signal_name', coalesce(dp.name, dpr.name, s.keyword_matched),
              'source', s.source_field,
              'snippet', left(s.snippet, 200)
            ))
            from signals s
            left join dictionary_products dp on dp.id = s.signal_id and s.signal_type = 'technology'
            left join dictionary_processes dpr on dpr.id = s.signal_id and s.signal_type = 'process'
            where s.contact_id = ct.id
              and s.is_current_employee = true
              and s.signal_id = any(v_filter_signal_ids)
          )
        ) as emp_row
        from contacts ct
        where ct.current_company_id = v_company_id
          and exists (
            select 1 from signals sig
            where sig.contact_id = ct.id
              and sig.is_current_employee = true
              and sig.signal_id = any(v_filter_signal_ids)
          )
      ) sub
      where (emp_row->>'signal_count')::int > 0
    ), '[]'::jsonb),

    -- Job Postings: solo con señal en el filtro
    'job_postings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', jp.title,
        'url', jp.job_url,
        'location', jp.location,
        'posted_at', jp.posted_at,
        'is_active', jp.is_active,
        'signals', (
          select jsonb_agg(jsonb_build_object(
            'signal_type', s.signal_type,
            'signal_name', coalesce(dp.name, dpr.name, s.keyword_matched)
          ))
          from signals s
          left join dictionary_products dp on dp.id = s.signal_id and s.signal_type = 'technology'
          left join dictionary_processes dpr on dpr.id = s.signal_id and s.signal_type = 'process'
          where s.job_posting_id = jp.id
            and s.signal_id = any(v_filter_signal_ids)
        )
      ) order by jp.posted_at desc nulls last)
      from job_postings jp
      where jp.company_id = v_company_id
        and jp.is_active = true
        and exists (
          select 1 from signals sig
          where sig.job_posting_id = jp.id
            and sig.signal_id = any(v_filter_signal_ids)
        )
    ), '[]'::jsonb),

    -- Prospects (Apollo): email ya priorizado por Apollo. Incluir
    -- mobile_phone y phone separados para poder elegir en la capa de export.
    'prospects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'first_name', ucc.first_name,
        'last_name', ucc.last_name,
        'headline', ucc.headline,
        'email', ucc.email,
        'email_status', ucc.email_status,
        'linkedin_url', ucc.linkedin_url,
        'phone', ucc.phone,
        'mobile_phone', ucc.mobile_phone,
        'seniority', ucc.seniority,
        'is_decision_maker', ucc.is_decision_maker,
        'departments', ucc.departments
      ) order by ucc.is_decision_maker desc nulls last, ucc.seniority)
      from user_company_contacts ucc
      where ucc.company_id = v_company_id and ucc.user_id = p_user_id
    ), '[]'::jsonb),

    'news', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', cn.title,
        'url', cn.source_url,
        'published_at', cn.published_at,
        'source', cn.source_name
      ) order by cn.published_at desc nulls last)
      from company_news cn
      where cn.company_id = v_company_id
      limit 10
    ), '[]'::jsonb),

    'implementations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_name', ci.technology,
        'vendor_name', ci.provider_name,
        'category', ci.area,
        'source_url', ci.source_url
      ))
      from company_implementations ci
      where ci.company_id = v_company_id
    ), '[]'::jsonb)

  ) into v_result;

  return v_result;
end;
$function$;
