-- ═══════════════════════════════════════════════════════════
-- Fase 9: textos generados de la radiografía, por workspace.
--
-- Son las tres piezas del informe que sí necesitan IA: el resumen ejecutivo en
-- 4 puntos, los ángulos de entrada y los riesgos. Todo lo demás del informe
-- (semáforo, scorecard operativo, movimientos, vacantes, noticias, método) es
-- determinístico y se arma en cada render sin costo.
--
-- Se generan en UNA llamada batch (~US$0,001) cuando cambia `inputs_fingerprint`
-- — entraron vacantes o noticias nuevas, o cambió la propuesta de valor — y se
-- guardan. Abrir la cuenta cien veces con los mismos datos no gasta nada
-- (decisión H.5).
--
-- Por workspace, igual que las lecturas de noticias: los ángulos de entrada de
-- quien vende datacenters no son los de un workspace de staffing.
-- ═══════════════════════════════════════════════════════════

create table if not exists v3.account_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references v3.workspaces(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  /** 4 bullets factuales; uno declara explícitamente lo que NO se encontró. */
  summary_points text[] not null default '{}',
  entry_angles text[] not null default '{}',
  risks text[] not null default '{}',
  /** Huella de los insumos (account-report-rules.buildInputsFingerprint). */
  inputs_fingerprint text not null,
  generated_at timestamptz not null default now(),
  unique (workspace_id, company_id)
);

alter table v3.account_reports enable row level security;

comment on table v3.account_reports is
  'Fase 9: resumen/ángulos/riesgos de la radiografía por workspace. Se regeneran solo cuando cambia inputs_fingerprint.';
