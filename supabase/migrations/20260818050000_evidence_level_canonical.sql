-- =============================================================================
-- Normaliza `evidence_level` en la vista canónica company_evidence
--
-- Hallazgo posterior a 20260818045619_evidence_contract.sql: las tablas usan
-- DOS vocabularios distintos para el mismo concepto, verificado en producción:
--   company_implementations → directa (309) | convergente (260) | inferencia (104) | null (54)
--   radar_findings          → explicit (405) | inferred (301)
--
-- La vista los exponía crudos, así que `evidence_level` era justamente la
-- columna que NO quedaba unificada. Esta migración la normaliza al vocabulario
-- canónico de lib/shared/evidence-level.ts (Confirmado | Probable | Inferido) y
-- deja el valor original en `evidence_level_raw` para no perder trazabilidad.
--
-- Aditiva: no toca las tablas ni sus datos, sólo redefine la vista.
-- =============================================================================

-- Espejo SQL de `toEvidenceLevel()` en lib/shared/evidence-level.ts.
-- Si allá se agrega un valor legacy, hay que agregarlo acá.
create or replace function public.canonical_evidence_level(value text)
returns text
language sql
immutable
parallel safe
as $$
  select case lower(trim(coalesce(value, '')))
    -- v3 radar_findings + v2 migrado + v2 original
    when 'explicit'    then 'Confirmado'
    when 'directa'     then 'Confirmado'
    when 'strong'      then 'Confirmado'
    when 'confirmado'  then 'Confirmado'
    when 'convergente' then 'Probable'
    when 'medium'      then 'Probable'
    when 'probable'    then 'Probable'
    -- inferred, inferencia, weak, inferido, sin_evidencia, null y desconocidos:
    -- el default seguro es el nivel más débil. Nunca presentar como confirmado
    -- algo que no se pudo verificar.
    else 'Inferido'
  end;
$$;

comment on function public.canonical_evidence_level(text) is
  'Traduce cualquier dialecto de evidence_level al canónico (Confirmado|Probable|Inferido). Espejo de toEvidenceLevel() en lib/shared/evidence-level.ts';

drop view if exists public.company_evidence;

create view public.company_evidence
with (security_invoker = true)
as
select
  'news'::text                                     as evidence_kind,
  n.id, n.company_id, n.title, n.summary,
  n.source_url, n.source_name,
  n.published_at                                   as occurred_at,
  n.created_at                                     as detected_at,
  n.category,
  public.canonical_evidence_level(n.evidence_level) as evidence_level,
  n.evidence_level                                 as evidence_level_raw,
  n.confidence, n.produced_by, n.sourced_by_workspace, n.requested_by,
  n.verified_at, n.micro_agent, n.convergent_sources,
  n.supporting_sources, n.prompt_version
from public.company_news n

union all

select
  'implementation'::text,
  i.id, i.company_id, i.title, i.summary,
  i.source_url, i.source_name,
  i.published_at, i.created_at,
  i.area                                            as category,
  public.canonical_evidence_level(i.evidence_level),
  i.evidence_level,
  i.confidence, i.produced_by, i.sourced_by_workspace, i.requested_by,
  i.verified_at, i.micro_agent, i.convergent_sources,
  i.supporting_source_urls                          as supporting_sources,
  i.prompt_version
from public.company_implementations i

union all

select
  'radar'::text,
  r.id, r.company_id, r.title, r.summary,
  r.url                                             as source_url,
  r.source_name,
  r.source_date::timestamptz                        as occurred_at,
  r.detected_at,
  r.category,
  public.canonical_evidence_level(r.evidence_level),
  r.evidence_level,
  r.confidence, r.produced_by, r.sourced_by_workspace, r.requested_by,
  r.verified_at, r.micro_agent, r.convergent_sources,
  r.supporting_sources, r.prompt_version
from public.radar_findings r;

comment on view public.company_evidence is
  'Vista canónica de evidencia por compañía: unifica company_news, company_implementations y radar_findings bajo un mismo esquema y un mismo vocabulario de evidence_level, sin mover datos. Escritura: lib/shared/evidence.ts';

grant select on public.company_evidence to authenticated;
grant select on public.company_evidence to service_role;
grant execute on function public.canonical_evidence_level(text) to authenticated, service_role;
