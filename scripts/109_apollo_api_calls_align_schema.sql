-- Alinea el schema real de apollo_api_calls con lo que el logger espera escribir.
--
-- El bug: la tabla existe desde antes con un schema distinto al de la migracion
-- 101. El logger actual intenta insertar columnas que no existen (query_hash,
-- credits_estimated, metadata) y usa nombres distintos (error_message vs error,
-- total_entries vs response_total_entries). Resultado: cada insert falla con
-- "column does not exist" y la tabla queda vacia.
--
-- Solucion: ADD COLUMN IF NOT EXISTS para alinear ambos mundos sin tocar datos
-- existentes. No creamos aliases para los nombres que difieren (error, total_entries)
-- porque el logger se adapta a los nombres reales en codigo.

-- Columnas faltantes usadas por el logger
alter table if exists apollo_api_calls add column if not exists query_hash text;
alter table if exists apollo_api_calls add column if not exists credits_estimated integer default 0;
alter table if exists apollo_api_calls add column if not exists metadata jsonb default '{}'::jsonb;

-- Indices para dashboards y diagnostico
create index if not exists idx_apollo_api_calls_endpoint_created
  on apollo_api_calls(endpoint, created_at desc);

create index if not exists idx_apollo_api_calls_query_hash
  on apollo_api_calls(query_hash)
  where query_hash is not null;

create index if not exists idx_apollo_api_calls_user_created
  on apollo_api_calls(user_id, created_at desc)
  where user_id is not null;

-- Sanity check: metadata NO debe ser null para evitar bugs en consumidores
update apollo_api_calls set metadata = '{}'::jsonb where metadata is null;

comment on column apollo_api_calls.query_hash is 'Hash deterministico de los params de busqueda (matching con apollo_search_queries)';
comment on column apollo_api_calls.credits_estimated is 'Creditos Apollo estimados consumidos por esta llamada';
comment on column apollo_api_calls.metadata is 'Metadatos extra del logger (attempts, apollo_id, webhook_url, etc)';
