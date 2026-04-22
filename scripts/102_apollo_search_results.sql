-- Fase 2: cache determinístico por query_hash
-- Reemplaza la lógica de searchApolloCache que hacía hits por domain+titles con matching
-- substring (causaba cross-contamination entre búsquedas con filtros distintos).

-- Tabla de búsquedas ejecutadas, con su hash determinístico y los metadatos del request.
create table if not exists apollo_search_queries (
  id uuid primary key default gen_random_uuid(),
  query_hash text not null unique,
  -- Payload normalizado (para debug y auditoría)
  organization_id text,
  person_titles text[] not null default '{}',
  person_locations text[] not null default '{}',
  organization_locations text[] not null default '{}',
  person_seniorities text[] not null default '{}',
  person_departments text[] not null default '{}',
  include_similar_titles boolean not null default true,
  -- Métricas de la corrida
  total_entries integer not null default 0,
  result_count integer not null default 0,
  pages_fetched integer not null default 1,
  reveal_email boolean not null default false,
  reveal_phone boolean not null default false,
  -- Trazabilidad
  fetched_at timestamptz not null default now(),
  fetched_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '14 days')
);

create index if not exists idx_apollo_search_queries_hash on apollo_search_queries (query_hash);
create index if not exists idx_apollo_search_queries_expires on apollo_search_queries (expires_at);
create index if not exists idx_apollo_search_queries_org on apollo_search_queries (organization_id);

-- Join table entre búsquedas y contactos cacheados (many-to-many).
-- Una persona puede aparecer en múltiples búsquedas; una búsqueda incluye muchas personas.
create table if not exists apollo_search_results (
  query_id uuid not null references apollo_search_queries(id) on delete cascade,
  contact_cache_id uuid not null references apollo_contacts_cache(id) on delete cascade,
  position integer not null default 0,
  primary key (query_id, contact_cache_id)
);

create index if not exists idx_apollo_search_results_query on apollo_search_results (query_id);
create index if not exists idx_apollo_search_results_contact on apollo_search_results (contact_cache_id);

-- RLS: las queries son globales (compartibles entre usuarios para maximizar hit rate)
-- pero solo service_role puede escribir.
alter table apollo_search_queries enable row level security;
alter table apollo_search_results enable row level security;

drop policy if exists "apollo_search_queries_select_all" on apollo_search_queries;
create policy "apollo_search_queries_select_all" on apollo_search_queries
  for select using (auth.role() = 'authenticated');

drop policy if exists "apollo_search_queries_service_write" on apollo_search_queries;
create policy "apollo_search_queries_service_write" on apollo_search_queries
  for all using (auth.role() = 'service_role');

drop policy if exists "apollo_search_results_select_all" on apollo_search_results;
create policy "apollo_search_results_select_all" on apollo_search_results
  for select using (auth.role() = 'authenticated');

drop policy if exists "apollo_search_results_service_write" on apollo_search_results;
create policy "apollo_search_results_service_write" on apollo_search_results
  for all using (auth.role() = 'service_role');

-- Función helper: resolver cache hit en un solo query.
-- Devuelve el query row si existe un hash válido (no expirado).
create or replace function apollo_get_cached_search(p_query_hash text)
returns setof apollo_search_queries
language sql
stable
as $$
  select * from apollo_search_queries
  where query_hash = p_query_hash
    and expires_at > now()
  limit 1;
$$;
