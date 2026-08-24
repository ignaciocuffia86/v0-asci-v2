-- ═══════════════════════════════════════════════════════════════════
-- Recálculos de co-ocurrencia diferidos a la noche
--
-- Qué cambia
-- ----------
-- Cambiar keywords_contexto o keywords_excluye de una keyword que ya existe
-- obliga a rehacer sus señales: las viejas se generaron con las reglas
-- anteriores. El diálogo ya encolaba ese recálculo como remove + add, pero
-- caía en el cron que corre CADA MINUTO, junto con todo lo demás.
--
-- Eso está mal repartido. Agregar o sacar una keyword es una operación que el
-- editor quiere ver funcionar enseguida. Un recálculo, en cambio, es trabajo
-- pesado sobre señales que YA existen y que nadie está esperando: reprocesar
-- "Exchange" toca ~5.000 contactos y no cambia nada que el editor necesite en
-- el momento. Compite con el trabajo interactivo sin ganar nada.
--
-- Se agrega entonces un estado 'deferred': el job queda encolado pero invisible
-- para el cron del minuto, que solo mira 'pending' y 'processing'. Un cron
-- nocturno los pasa a 'pending' y el cron del minuto los drena de ahí.
--
-- El cron del minuto no se toca. Su selector ya es
--   .in("status", ["processing", "pending"])
-- así que 'deferred' queda afuera sin cambiarle una línea al camino caliente.
--
-- Por qué un estado y no un timestamp
-- -----------------------------------
-- La alternativa era scheduled_for timestamptz y que el cron del minuto
-- filtrara por <= now(). Sale más caro: hay que tocar el selector del cron
-- caliente, y cada job carga una fecha que solo sirve una vez. El estado
-- separa las dos preguntas —"¿está listo para correr?" y "¿cuándo se liberó?"—
-- y deja el release como una decisión de un solo lugar.
--
-- Orden remove → add
-- ------------------
-- El cron ordena por created_at, y el release nocturno NO toca created_at:
-- solo cambia status. El orden con el que se encolaron los dos jobs de una
-- misma keyword se preserva, que es justo lo que evita que un add corra antes
-- que su remove y deje la keyword borrada.
-- ═══════════════════════════════════════════════════════════════════

alter table public.dictionary_jobs
  drop constraint if exists dictionary_jobs_status_check;
alter table public.dictionary_jobs
  add constraint dictionary_jobs_status_check
  check (status in ('pending', 'processing', 'completed', 'failed', 'deferred'));

-- Un solo recálculo pendiente por (producto, keyword, tipo de job).
--
-- Editar la misma keyword tres veces antes de la noche no encola tres
-- recálculos: el job no lleva las reglas adentro, lee keywords_contexto y
-- keywords_excluye de la tabla en el momento de correr. Así que un job
-- diferido ya encolado va a aplicar la última versión de las reglas, y los
-- siguientes serían trabajo repetido. El índice deja que el insert use
-- ON CONFLICT DO NOTHING en vez de tener que borrar (no hay policy de DELETE
-- sobre dictionary_jobs para el rol authenticated).
create unique index if not exists idx_dictionary_jobs_deferred_unico
  on public.dictionary_jobs (signal_id, keyword, job_type)
  where status = 'deferred';

comment on index public.idx_dictionary_jobs_deferred_unico is
  'Un recalculo diferido por producto+keyword+tipo. El job relee las reglas al correr, asi que encolar el mismo dos veces es trabajo repetido.';

-- Encolado del recálculo.
--
-- Va por RPC y no por insert directo desde el browser por dos razones:
--
--  1. ON CONFLICT contra un índice PARCIAL necesita repetir el predicado del
--     índice (`... where status = 'deferred'`) para que Postgres lo infiera.
--     PostgREST no sabe expresar eso: su `on_conflict` es solo una lista de
--     columnas, así que el upsert desde el cliente fallaría con "no unique or
--     exclusion constraint matching the ON CONFLICT specification".
--
--  2. El orden remove → add deja de depender de dos round-trips separados. Los
--     dos jobs se insertan en la misma transacción con created_at explícito y
--     un milisegundo de diferencia, así el cron —que ordena por created_at— no
--     puede correr el add antes que su remove y dejar la keyword borrada.
create or replace function public.enqueue_dictionary_recalc(
  p_signal_id uuid,
  p_signal_type text,
  p_keywords text[]
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_inserted integer := 0;
  v_n integer;
  v_kw text;
  v_now timestamptz := now();
begin
  -- SECURITY DEFINER saltea RLS, así que el chequeo se hace acá a mano. Es la
  -- misma condición que las policies de dictionary_jobs.
  if not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'superadmin'
  ) then
    raise exception 'no autorizado para encolar recalculos de diccionario';
  end if;

  if p_signal_type not in ('technology', 'process') then
    raise exception 'signal_type invalido: %', p_signal_type;
  end if;

  foreach v_kw in array coalesce(p_keywords, array[]::text[]) loop
    if btrim(coalesce(v_kw, '')) = '' then
      continue;
    end if;

    insert into public.dictionary_jobs (job_type, signal_id, signal_type, keyword, status, created_at)
    values ('remove_keyword', p_signal_id, p_signal_type, v_kw, 'deferred', v_now)
    on conflict (signal_id, keyword, job_type) where status = 'deferred' do nothing;
    get diagnostics v_n = row_count;
    v_inserted := v_inserted + v_n;

    insert into public.dictionary_jobs (job_type, signal_id, signal_type, keyword, status, created_at)
    values ('add_keyword', p_signal_id, p_signal_type, v_kw, 'deferred', v_now + interval '1 millisecond')
    on conflict (signal_id, keyword, job_type) where status = 'deferred' do nothing;
    get diagnostics v_n = row_count;
    v_inserted := v_inserted + v_n;
  end loop;

  return v_inserted;
end;
$fn$;

revoke all on function public.enqueue_dictionary_recalc(uuid, text, text[]) from public;
grant execute on function public.enqueue_dictionary_recalc(uuid, text, text[]) to authenticated;

comment on function public.enqueue_dictionary_recalc(uuid, text, text[]) is
  'Encola el recalculo diferido (remove + add) de las keywords cuyas reglas de co-ocurrencia cambiaron. Solo superadmin. Idempotente por el indice parcial de deferred.';

-- Libera los diferidos. La corre el cron nocturno /api/cron/dictionary-reprocess.
--
-- NO toca created_at: el orden con el que se encolaron los pares remove → add
-- es justamente lo que mantiene la consistencia cuando el cron del minuto los
-- drena.
create or replace function public.release_deferred_dictionary_jobs()
returns integer
language sql
security definer
set search_path to 'public'
as $fn$
  with liberados as (
    update public.dictionary_jobs
    set status = 'pending'
    where status = 'deferred'
    returning 1
  )
  select coalesce(count(*), 0)::integer from liberados;
$fn$;

revoke all on function public.release_deferred_dictionary_jobs() from public;
grant execute on function public.release_deferred_dictionary_jobs() to service_role;

comment on function public.release_deferred_dictionary_jobs() is
  'Pasa los jobs diferidos a pending para que los drene el cron del minuto. Preserva created_at a proposito.';
