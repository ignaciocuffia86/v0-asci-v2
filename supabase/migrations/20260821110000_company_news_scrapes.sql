-- ═══════════════════════════════════════════════════════════
-- Fase 8: bitácora de scrapes de noticias (global, por compañía).
--
-- Por qué una tabla y no derivarlo de company_news: si una búsqueda no
-- encuentra nada, no se inserta ninguna noticia — y sin marca, la próxima
-- visita al bookmark vuelve a gastar los ~US$0,17. Es exactamente la lección
-- del corredor de vacantes (marcar el intento ANTES de gastar): sin la marca
-- previa, una cuenta sin novedades se re-dispara en cada visita.
--
-- Además es la fuente de la sección "Método y limitaciones" del informe: qué
-- día se buscó, con qué ventana y cuántas noticias entraron.
-- ═══════════════════════════════════════════════════════════

create table if not exists public.company_news_scrapes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- 'running' se escribe ANTES de la búsqueda; el resto al terminar.
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  /** Noticias nuevas insertadas (0 es un resultado válido, no un error). */
  items_inserted integer not null default 0,
  /** Ventana pedida a la búsqueda, en meses; queda registrada para el informe. */
  window_months integer,
  error_message text
);

-- "¿Cuándo fue el último scrape de esta compañía?": la pregunta de elegibilidad.
create index if not exists idx_company_news_scrapes_company
  on public.company_news_scrapes (company_id, started_at desc);

comment on table public.company_news_scrapes is
  'Fase 8: un intento de scrape de noticias por compañía. Se marca ANTES de gastar para que una búsqueda sin resultados no se re-dispare en cada visita.';
