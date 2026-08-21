-- ═══════════════════════════════════════════════════════════
-- Fase 8 (radiografía self-service): lectura de noticias por workspace.
--
-- Principio del diseño (sección G): el HECHO es global y la LECTURA es por
-- workspace. `public.company_news` ya es global y compartida — si tres
-- workspaces siguen YPF se paga UN scrape (~US$0,17). Lo que cambia por
-- workspace es qué significa esa noticia para lo que vende:
--
--   "proyecto de innovación con datacenter nuevo"
--     · workspace que vende datacenters → relevancia 'propuesta' (se destaca)
--     · workspace de staffing           → relevancia 'negocio' (se expande,
--                                          va a contratar)
--
-- Por eso la lectura no puede vivir en company_news: va acá, con unique por
-- (workspace_id, news_id).
--
-- RLS deshabilitada como el resto de v3: se accede con service-role y el
-- filtro por workspace_id se aplica en TypeScript.
-- ═══════════════════════════════════════════════════════════

create table if not exists v3.account_news_readings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references v3.workspaces(id) on delete cascade,
  news_id uuid not null references public.company_news(id) on delete cascade,
  company_id uuid not null,
  -- 'propuesta' = toca lo que vende el workspace (destacada)
  -- 'negocio'   = habla de la situación/capacidad de la cuenta (contexto)
  -- 'ruido'     = no aporta a este workspace (se colapsa, NO se borra)
  relevance_type text not null check (relevance_type in ('propuesta', 'negocio', 'ruido')),
  -- 0-100 determinístico (news-rules.computeNewsRelevance): ordena el radar y
  -- alimenta el semáforo de la cuenta.
  relevance_score integer not null default 0,
  -- 1-2 oraciones redactadas por IA citando el dato concreto. Puede ser NULL:
  -- las noticias 'ruido' no se mandan a redactar (no vale gastar en ellas).
  why_it_matters text,
  -- Términos de la propuesta/diccionario que matchearon: es el PORQUÉ visible
  -- de que la noticia esté destacada, no solo el hecho de que lo esté.
  matched_terms text[] not null default '{}',
  -- Hash del perfil de valor con el que se generó la lectura
  -- (getWorkspaceFitProfile().version). Si cambia, la lectura se regenera sola
  -- al abrir el bookmark (~US$0,0004) sin repetir el scrape: el hecho no
  -- cambió, cambió la propuesta.
  profile_version text,
  created_at timestamptz not null default now(),
  unique (workspace_id, news_id)
);

-- Listado del radar: todas las lecturas de una cuenta para un workspace,
-- ordenadas por relevancia.
create index if not exists idx_account_news_readings_lookup
  on v3.account_news_readings (workspace_id, company_id, relevance_score desc);

alter table v3.account_news_readings enable row level security;

comment on table v3.account_news_readings is
  'Fase 8: interpretación por workspace de una noticia global de company_news. El hecho se paga una vez y se comparte; la lectura es específica de la propuesta de valor.';
