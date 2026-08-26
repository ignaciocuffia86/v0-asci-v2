-- ═══════════════════════════════════════════════════════════
-- Ledger de gasto de Apify: poder decir en qué se va la plata cuando esto escale.
--
-- QUÉ PROBLEMA CIERRA
--   Dos huecos medidos contra la base real, no supuestos:
--
--   1. APIFY. El scraping del cron (`job-scrape-runner`) no pasa por una reserva
--      de MCP, así que su costo NO se registra en ningún lado. El cron es el que
--      más va a gastar cuando haya 100 usuarios: hoy es el único gasto del que no
--      queda rastro. Lo mismo el scraping del server `explore`.
--
--   2. IA. El 78% del gasto de IA registrado (US$ 57 de US$ 73) tiene
--      `workspace_id` NULL, y `get_cost_summary` filtraba por workspace: el grueso
--      del gasto era INVISIBLE para la única herramienta que existe para mirarlo.
--      No es un bug del filtro —el gasto del cron efectivamente no es de ningún
--      workspace— sino que faltaba mirarlo por su propia dimensión. Eso se
--      resuelve SIN migración, leyendo ese bucket y cortándolo por `feature`.
--
--      Queda pendiente `source` en `ai_usage_log` (QUIÉN lo disparó, que `feature`
--      no dice). No entra acá a propósito: llenarla exige atravesar cron →
--      pipeline → radar → engine y una columna en `research_jobs`, y una columna
--      que nadie escribe es peor que no tenerla.
--
-- POR QUÉ POR EMPRESA Y NO POR USUARIO
--   El cron DEDUPLICA por empresa (`byCompany` en v3-scrape-job-postings): una
--   corrida sirve a todos los workspaces que siguen esa cuenta, y el `userId` que
--   queda en el batch es el del primer seguidor que aparece en el map — arbitrario.
--   Cobrarle esa corrida a esa persona haría que un usuario se vea caro por
--   trabajo que aprovecharon todos. Con 100 usuarios y solapamiento en las
--   empresas grandes, el error crece.
--
--   Además el costo escala con EMPRESAS DISTINTAS, no con bookmarks: 100 usuarios
--   x 200 bookmarks pueden ser 20.000 empresas o 5.000 según cuánto se solapen, y
--   esa diferencia es el presupuesto entero. Por eso la unidad es la empresa y el
--   `user_id` queda informativo, explícitamente NO facturable.
--
-- POR QUÉ UNA TABLA Y NO LA METADATA DE LA RESERVA
--   La reserva solo existe en el camino del MCP. El cron y el kick de la UI no
--   tienen ninguna, y son justamente los que más van a correr. Una sola fuente
--   para los cuatro orígenes evita el desfasaje de dos registros que se actualizan
--   por separado — el mismo problema que dejó nueve tools inalcanzables cuando el
--   catálogo de scopes se desacopló de las tools registradas.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Una fila por corrida de Apify ───────────────────────────────────────
create table if not exists v3.apify_runs (
  id uuid primary key default gen_random_uuid(),

  -- El id que devuelve Apify. UNIQUE para que un reintento del registro no
  -- duplique el costo: el insert es idempotente por naturaleza.
  run_id text not null unique,

  -- La unidad de atribución. ON DELETE SET NULL y no CASCADE: si se borra la
  -- empresa el gasto YA OCURRIÓ y su fila tiene que sobrevivir, o el total
  -- histórico se achica solo.
  company_id uuid references public.companies(id) on delete set null,

  -- Quién lo disparó. Es la dimensión que hoy no existe en ningún lado.
  --   cron_first_pass — alta nueva, sin límite de fecha
  --   cron_monthly    — refresh mensual, ventana 30d
  --   ui_kick         — primer scrape al seguir una cuenta desde la UI
  --   mcp_tool        — scrape_company_job_postings (server standard/admin)
  --   mcp_explore     — explore_scrape_jobs
  source text not null check (source in (
    'cron_first_pass', 'cron_monthly', 'ui_kick', 'mcp_tool', 'mcp_explore'
  )),

  -- NULL cuando el gasto es COMPARTIDO (el cron). No es un dato faltante: es la
  -- respuesta correcta, y distinguirla de un workspace concreto es el punto.
  workspace_id uuid,

  -- Informativo. NO es a quién se le cobra: ver la nota de arriba.
  user_id uuid,

  -- El informe del MCP admin al que pertenece, si es parte de uno.
  batch_job_id uuid references v3.mcp_batch_jobs(id) on delete set null,

  -- Lo que Apify cobró por la corrida (`usageTotalUsd`). NULL = no se pudo leer.
  -- NUNCA 0 por omisión: cero significa "no gastó" y null "no sabemos", y poner
  -- cero donde no sabemos es la forma más barata de subreportar un costo.
  --
  -- No incluye el alquiler mensual del actor (FLAT_PRICE_PER_MONTH, US$ 29,99),
  -- que es un fijo y no se prorratea. Es el costo MARGINAL de la corrida.
  cost_usd numeric(12,6),

  rows_ingested integer not null default 0,

  -- Estado final del run de Apify (SUCCEEDED, TIMED-OUT, …). Un run que falló
  -- también se paga, así que su fila va igual.
  status text,

  created_at timestamptz not null default now()
);

comment on table v3.apify_runs is
  'Una fila por corrida de Apify, con su costo medido. Unidad de atribución: la EMPRESA. user_id es informativo, no facturable — el cron deduplica por empresa entre workspaces.';

-- El corte natural del monitoreo: "en qué se fue la plata este mes, por origen".
create index if not exists apify_runs_source_created_idx on v3.apify_runs (source, created_at desc);
-- "cuánto llevamos gastado en esta empresa".
create index if not exists apify_runs_company_created_idx on v3.apify_runs (company_id, created_at desc);
-- El costo de UN informe del MCP admin. Parcial: la enorme mayoría de las
-- corridas no pertenece a ningún lote.
create index if not exists apify_runs_batch_job_idx on v3.apify_runs (batch_job_id) where batch_job_id is not null;

alter table v3.apify_runs enable row level security;

-- Sin políticas: se escribe y se lee SOLO con la service role (el ledger lo
-- escriben crons y rutas de server). Un cliente no tiene por qué ver el costo
-- de una corrida que sirvió a varios workspaces.
