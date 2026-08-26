-- ═══════════════════════════════════════════════════════════
-- El batchPlanHash pasa a AUTORIZAR créditos de Apollo.
--
-- QUÉ PROBLEMA CIERRA
--   El perfil admin levanta los topes de cuenta y de cupo. Para Apollo eso no se
--   podía hacer: el cupo mensual del plan era el ÚNICO techo enforceable del
--   gasto irreversible, porque la "confirmación explícita del usuario" que piden
--   las descripciones vive en el prompt, y un prompt se convence.
--
--   Sin un reemplazo, liberar el cupo dejaba al perfil sin ningún techo real. Con
--   esto el techo se MUEVE: del mes calendario del plan al lote que alguien
--   cotizó y autorizó.
--
-- CÓMO
--   `estimate_batch` ya congelaba los roles y los contactos por cuenta dentro del
--   hash, así que el hash ya DESCRIBÍA el trabajo de Apollo. Lo que faltaba era
--   que autorizara un gasto: eso es `enrichment_credits_authorized`, calculado en
--   el server a partir del plan guardado —nunca de lo que mande quien llama— y
--   `enrichment_credits_spent`, que lleva lo realmente consumido.
--
--   `prepare_contact_enrichment` con un `batchJobId` cobra contra ese presupuesto
--   en vez de contra el cupo mensual. SIN `batchJobId` nada cambia: sigue rigiendo
--   el cupo del plan, para todos los perfiles. Así no queda un hueco donde una
--   credencial sin topes gaste Apollo sin ninguna autorización.
--
-- POR QUÉ `batch_job_id` EN LAS CORRIDAS
--   Para poder descontar del presupuesto correcto, para que `get_cost_summary`
--   ate el gasto al informe sin depender de cruzar plan_hash, y para que un
--   reintento no descuente dos veces: la corrida ya sabe a qué lote pertenece.
-- ═══════════════════════════════════════════════════════════

alter table v3.mcp_batch_jobs
  add column if not exists enrichment_credits_authorized integer,
  add column if not exists enrichment_credits_spent integer not null default 0;

comment on column v3.mcp_batch_jobs.enrichment_credits_authorized is
  'Créditos de Apollo que autorizó el batchPlanHash, en el PEOR CASO (cuentas x contactos por cuenta). null = el lote no incluye enrichment. Se calcula en el server desde el plan congelado, nunca desde el input.';

comment on column v3.mcp_batch_jobs.enrichment_credits_spent is
  'Créditos realmente consumidos contra este lote. Lo incrementa run_contact_enrichment al cerrar cada corrida, con las unidades reales, no con las reservadas.';

alter table v3.contact_enrichment_runs
  add column if not exists batch_job_id uuid references v3.mcp_batch_jobs(id) on delete set null;

create index if not exists contact_enrichment_runs_batch_idx
  on v3.contact_enrichment_runs (batch_job_id)
  where batch_job_id is not null;

comment on column v3.contact_enrichment_runs.batch_job_id is
  'Lote que autorizó esta corrida. Cuando está, el techo del gasto es el presupuesto del lote y no el cupo mensual del plan.';

-- ── Sumar consumo sin perder incrementos concurrentes ───────
--
-- Un lote corre varias cuentas y sus enrichments pueden cerrar a la vez. Leer el
-- valor, sumarle y escribirlo desde la aplicación pierde incrementos cuando dos
-- corridas terminan juntas: las dos leen el mismo número y la segunda pisa a la
-- primera. El presupuesto quedaría reportando menos gasto del real, que es la
-- dirección peligrosa del error.
--
-- El UPDATE con la suma adentro es atómico y no tiene ese problema.
create or replace function v3.increment_batch_credits(p_batch_job_id uuid, p_credits integer)
returns void
language sql
security definer
set search_path = v3, public
as $$
  update v3.mcp_batch_jobs
     set enrichment_credits_spent = coalesce(enrichment_credits_spent, 0) + greatest(p_credits, 0)
   where id = p_batch_job_id;
$$;

comment on function v3.increment_batch_credits(uuid, integer) is
  'Suma créditos consumidos al lote de forma atómica. Un read-modify-write desde la aplicación pierde incrementos cuando dos enrichments del mismo lote cierran a la vez.';

revoke all on function v3.increment_batch_credits(uuid, integer) from public, anon, authenticated;
