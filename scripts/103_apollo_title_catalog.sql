-- Fase 4: Catálogo de títulos alimentado por feedback loop
-- Cada vez que Apollo devuelve resultados, guardamos los títulos para luego
-- proponerlos en el autocomplete UI.

create table if not exists apollo_title_catalog (
  normalized_title text primary key,                -- lowercase + trim, ej: "chief financial officer"
  display_title text not null,                      -- forma canónica, ej: "Chief Financial Officer"
  language text,                                    -- 'en' | 'es' | 'pt' | null
  seniority text,                                   -- 'c_suite' | 'vp' | 'director' | 'manager' | ...
  department text,                                  -- 'finance' | 'engineering' | ...
  aliases text[] not null default '{}',             -- ['CFO', 'Director Financiero', 'Finance Director']
  usage_count integer not null default 0,           -- veces que Apollo lo devolvió como person.title
  success_count integer not null default 0,         -- veces que fue usado en search y devolvió >0
  last_success_entries integer default 0,           -- total_entries de la última búsqueda exitosa
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_apollo_title_catalog_dept
  on apollo_title_catalog (department)
  where department is not null;

create index if not exists idx_apollo_title_catalog_seniority
  on apollo_title_catalog (seniority)
  where seniority is not null;

create index if not exists idx_apollo_title_catalog_success
  on apollo_title_catalog (success_count desc, usage_count desc);

create index if not exists idx_apollo_title_catalog_aliases
  on apollo_title_catalog using gin (aliases);

create index if not exists idx_apollo_title_catalog_trgm
  on apollo_title_catalog using gin (display_title gin_trgm_ops);

-- Extensión trigram para autocomplete fuzzy
create extension if not exists pg_trgm;

-- RLS: lectura para authenticated, escritura sólo service_role
alter table apollo_title_catalog enable row level security;

drop policy if exists "apollo_title_catalog_read" on apollo_title_catalog;
create policy "apollo_title_catalog_read"
  on apollo_title_catalog for select
  to authenticated
  using (true);

drop policy if exists "apollo_title_catalog_write" on apollo_title_catalog;
create policy "apollo_title_catalog_write"
  on apollo_title_catalog for all
  to service_role
  using (true)
  with check (true);

-- Función: registrar un título observado en una respuesta de Apollo
create or replace function apollo_record_title_observation(
  p_title text,
  p_seniority text default null,
  p_department text default null
)
returns void
language plpgsql
security definer
as $$
declare
  v_normalized text;
  v_display text;
begin
  if p_title is null or trim(p_title) = '' then
    return;
  end if;

  v_display := trim(p_title);
  v_normalized := lower(v_display);

  insert into apollo_title_catalog (
    normalized_title, display_title, seniority, department, usage_count, last_seen_at
  ) values (
    v_normalized, v_display, p_seniority, p_department, 1, now()
  )
  on conflict (normalized_title) do update set
    usage_count = apollo_title_catalog.usage_count + 1,
    last_seen_at = now(),
    updated_at = now(),
    seniority = coalesce(apollo_title_catalog.seniority, excluded.seniority),
    department = coalesce(apollo_title_catalog.department, excluded.department);
end;
$$;

-- Función: registrar que un título se usó con éxito (total_entries > 0)
create or replace function apollo_record_title_success(
  p_title text,
  p_entries integer
)
returns void
language plpgsql
security definer
as $$
declare
  v_normalized text;
begin
  if p_title is null or trim(p_title) = '' then
    return;
  end if;

  v_normalized := lower(trim(p_title));

  update apollo_title_catalog
  set success_count = success_count + 1,
      last_success_entries = p_entries,
      updated_at = now()
  where normalized_title = v_normalized;
end;
$$;

-- Vista helper para autocomplete (filtrable por department/seniority)
create or replace view apollo_title_catalog_ranked as
select
  normalized_title,
  display_title,
  language,
  seniority,
  department,
  aliases,
  usage_count,
  success_count,
  case
    when success_count > 0 then 'verified'
    when usage_count > 0 then 'seen'
    else 'inferred'
  end as status
from apollo_title_catalog
order by success_count desc, usage_count desc;
