-- ═══════════════════════════════════════════════════════════════════
-- Recuperar la fecha real de las vacantes que quedaron fechadas con now()
--
-- 20260825002000 arregló el ETL hacia adelante. Esta migración repara las
-- 25.056 vacantes (58% del total) que el bug ya había fechado mal.
--
-- Por qué se puede recuperar
-- --------------------------
-- El ON CONFLICT viejo sólo tocaba title, description y updated_at:
--
--   ON CONFLICT (job_url) DO UPDATE SET
--     title = EXCLUDED.title, description = EXCLUDED.description,
--     updated_at = now()
--
-- Nunca pisó `posted_at` ni `source_data`. Eso da dos garantías que hacen
-- posible la reparación:
--
--   1. `posted_at` se escribió UNA sola vez, en el INSERT original, con el
--      `now()` de ese momento. Por eso `abs(posted_at - created_at) < 2s`
--      identifica exactamente a las mal fechadas, sin banda difusa: medido,
--      no hay ninguna fila entre 2s y 60s de diferencia.
--   2. `source_data` es el row_data de ESE mismo INSERT, así que conserva el
--      string crudo que trajo el CSV ("2 weeks ago", "il y a 6 jours").
--
-- La fecha de referencia
-- ----------------------
-- Una fecha relativa no significa nada sin saber contra qué se resuelve.
-- `created_at` de la vacante no sirve: la mediana entre subir el lote y
-- procesar la fila es de 5 minutos, pero el p95 es de 40 horas y el máximo de
-- 32 días — 2.398 filas se procesaron más de un día después. Usar created_at
-- arrastraría ese error a la fecha reparada.
--
-- El lote correcto se reencuentra por `posting_url`, desempatando por
-- `processed_at`: como el UPDATE de import_rows corre en la misma transacción
-- que el INSERT de la vacante, processed_at coincide con created_at al
-- segundo cero. No es una heurística, es la misma transacción. Cobertura
-- medida: 25.049 de 25.056.
--
-- Lo que no se puede recuperar queda en NULL
-- ------------------------------------------
-- 93 filas traen basura de un CSV con las columnas corridas ("Région
-- métropolitaine de Buenos Aires", "Neuroscience\"", "NY\""). Ahí no hay
-- fecha que recuperar y se dejan en NULL, igual criterio que el arreglo hacia
-- adelante. Un NULL queda fuera del filtro de seis meses del drawer, que es lo
-- correcto para una vacante sin fecha; y los dos caminos del drawer filtran
-- por `posted_at >= ...`, así que ningún NULL llega al front.
--
-- La copia denormalizada en signals
-- ---------------------------------
-- `signals.job_posted_at` duplica el dato. Se resincroniza SÓLO donde ya
-- estaba seteada con la fecha mala (12.300 filas). Las 97.111 que están en
-- NULL se dejan como están: completarlas metería señales nuevas en la ventana
-- de seis meses del drawer, que es un cambio de alcance distinto a reparar
-- una fecha.
--
-- Reversible: job_posted_at_repair guarda posted_at_previo de cada fila.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.job_posted_at_repair (
  job_posting_id   uuid primary key references public.job_postings(id) on delete cascade,
  posted_at_previo timestamptz not null,
  crudo            text,
  referencia       timestamptz,
  batch_id         uuid,
  posted_at_nuevo  timestamptz,
  aplicado_at      timestamptz,
  detectado_at     timestamptz not null default now()
);

comment on table public.job_posted_at_repair is
  'Rastro reversible del backfill de posted_at. posted_at_previo permite deshacer con revert_job_posted_at_repair().';

alter table public.job_posted_at_repair enable row level security;

-- ───────────────────────────────────────────────────────────────────
-- Preparar: calcular la fecha propuesta sin tocar nada todavía
--
-- Paginado por keyset sobre el id porque el join contra import_rows sobre
-- 25k vacantes no entra en un solo statement con holgura.
-- ───────────────────────────────────────────────────────────────────
-- Los DROP hacen la migración reaplicable sobre una base donde estas funciones
-- ya existan con otra firma: CREATE OR REPLACE no puede cambiar el tipo de
-- retorno.
drop function if exists public.stage_job_posted_at_repair(uuid, int);
drop function if exists public.apply_job_posted_at_repair(int);
drop function if exists public.revert_job_posted_at_repair();

create function public.stage_job_posted_at_repair(p_after uuid, p_limit int)
returns table(vistas int, insertadas int, ultimo_id uuid)
language plpgsql as $function$
DECLARE v_vistas int; v_ins int; v_last uuid;
BEGIN
  -- El TRUNCATE importa: dentro de un bloque DO todas las llamadas comparten
  -- transacción, así que el ON COMMIT DROP no limpia entre una y otra.
  CREATE TEMP TABLE IF NOT EXISTS _lote(id uuid, created_at timestamptz, source_data jsonb, posted_at timestamptz) ON COMMIT DROP;
  TRUNCATE _lote;

  INSERT INTO _lote
  SELECT j.id, j.created_at, j.source_data, j.posted_at
  FROM public.job_postings j
  WHERE (p_after IS NULL OR j.id > p_after)
    AND j.posted_at IS NOT NULL
    AND abs(extract(epoch FROM j.posted_at - j.created_at)) < 2
  ORDER BY j.id
  LIMIT p_limit;

  SELECT count(*) INTO v_vistas FROM _lote;
  SELECT id INTO v_last FROM _lote ORDER BY id DESC LIMIT 1;

  -- Emparejar con la fila de importación que insertó la vacante.
  WITH emparejado AS (
    SELECT l.id, l.posted_at,
           btrim(l.source_data->>'posted_at') AS crudo,
           b.created_at AS referencia, b.id AS batch_id,
           row_number() OVER (PARTITION BY l.id
             ORDER BY abs(extract(epoch FROM r.processed_at - l.created_at))) AS rn
    FROM _lote l
    JOIN public.import_rows r
      ON r.row_data->>'posting_url' = l.source_data->>'posting_url'
    JOIN public.import_batches b
      ON b.id = r.batch_id AND b.batch_type = 'job_postings'
  )
  INSERT INTO public.job_posted_at_repair
    (job_posting_id, posted_at_previo, crudo, referencia, batch_id, posted_at_nuevo)
  SELECT e.id, e.posted_at, nullif(e.crudo,''), e.referencia, e.batch_id,
         public.parse_job_posted_at(nullif(e.crudo,''), e.referencia)
  FROM emparejado e
  WHERE e.rn = 1
  ON CONFLICT (job_posting_id) DO NOTHING;

  GET DIAGNOSTICS v_ins = ROW_COUNT;

  -- Huérfanas: sin lote que emparejar (filas basura, sin posting_url). Si el
  -- crudo trae una fecha absoluta todavía se recupera; si no, queda NULL.
  INSERT INTO public.job_posted_at_repair
    (job_posting_id, posted_at_previo, crudo, referencia, batch_id, posted_at_nuevo)
  SELECT l.id, l.posted_at, nullif(btrim(l.source_data->>'posted_at'),''), l.created_at, NULL,
         public.parse_job_posted_at(nullif(btrim(l.source_data->>'posted_at'),''), l.created_at)
  FROM _lote l
  LEFT JOIN public.job_posted_at_repair rp ON rp.job_posting_id = l.id
  WHERE rp.job_posting_id IS NULL
  ON CONFLICT (job_posting_id) DO NOTHING;

  RETURN QUERY SELECT v_vistas, v_ins, v_last;
END $function$;

comment on function public.stage_job_posted_at_repair(uuid, int) is
  'Calcula la fecha propuesta para las vacantes fechadas con now(). No modifica job_postings.';

-- ───────────────────────────────────────────────────────────────────
-- Aplicar
-- ───────────────────────────────────────────────────────────────────
create function public.apply_job_posted_at_repair(p_limit int)
returns table(consideradas int, vacantes int, senales int)
language plpgsql as $function$
DECLARE v_cons int; v_jobs int; v_sig int;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _apl(job_posting_id uuid PRIMARY KEY, nuevo timestamptz, previo timestamptz) ON COMMIT DROP;
  TRUNCATE _apl;

  INSERT INTO _apl
  SELECT rp.job_posting_id, rp.posted_at_nuevo, rp.posted_at_previo
  FROM public.job_posted_at_repair rp
  WHERE rp.aplicado_at IS NULL
  LIMIT p_limit;

  SELECT count(*) INTO v_cons FROM _apl;

  -- La guarda `j.posted_at = a.previo` evita pisar una fila que haya cambiado
  -- entre preparar y aplicar.
  UPDATE public.job_postings j
  SET posted_at = a.nuevo, updated_at = now()
  FROM _apl a
  WHERE j.id = a.job_posting_id AND j.posted_at = a.previo;
  GET DIAGNOSTICS v_jobs = ROW_COUNT;

  UPDATE public.signals s
  SET job_posted_at = a.nuevo
  FROM _apl a
  WHERE s.job_posting_id = a.job_posting_id AND s.job_posted_at = a.previo;
  GET DIAGNOSTICS v_sig = ROW_COUNT;

  UPDATE public.job_posted_at_repair rp
  SET aplicado_at = now()
  FROM _apl a WHERE rp.job_posting_id = a.job_posting_id;

  RETURN QUERY SELECT v_cons, v_jobs, v_sig;
END $function$;

comment on function public.apply_job_posted_at_repair(int) is
  'Escribe las fechas recuperadas en job_postings y resincroniza signals.job_posted_at.';

-- ───────────────────────────────────────────────────────────────────
-- Deshacer
-- ───────────────────────────────────────────────────────────────────
create function public.revert_job_posted_at_repair()
returns table(vacantes int, senales int)
language plpgsql as $function$
DECLARE v_jobs int; v_sig int;
BEGIN
  UPDATE public.signals s
  SET job_posted_at = rp.posted_at_previo
  FROM public.job_posted_at_repair rp
  WHERE s.job_posting_id = rp.job_posting_id
    AND rp.aplicado_at IS NOT NULL
    AND s.job_posted_at IS NOT DISTINCT FROM rp.posted_at_nuevo
    AND s.job_posted_at IS DISTINCT FROM rp.posted_at_previo;
  GET DIAGNOSTICS v_sig = ROW_COUNT;

  UPDATE public.job_postings j
  SET posted_at = rp.posted_at_previo, updated_at = now()
  FROM public.job_posted_at_repair rp
  WHERE j.id = rp.job_posting_id
    AND rp.aplicado_at IS NOT NULL
    AND j.posted_at IS NOT DISTINCT FROM rp.posted_at_nuevo;
  GET DIAGNOSTICS v_jobs = ROW_COUNT;

  UPDATE public.job_posted_at_repair SET aplicado_at = NULL WHERE aplicado_at IS NOT NULL;

  RETURN QUERY SELECT v_jobs, v_sig;
END $function$;

comment on function public.revert_job_posted_at_repair() is
  'Restaura el posted_at anterior al backfill en job_postings y signals.';

-- ───────────────────────────────────────────────────────────────────
-- Correr la reparación
--
-- No-op en una base ya reparada: no queda ninguna fila con
-- posted_at = created_at, así que el bucle sale en la primera vuelta.
-- ───────────────────────────────────────────────────────────────────
DO $do$
DECLARE
  v_cursor uuid := NULL;
  v_vistas int;
  v_last uuid;
  v_cons int;
  v_jobs int;
  v_sig int;
  v_total_jobs int := 0;
  v_total_sig int := 0;
BEGIN
  LOOP
    SELECT s.vistas, s.ultimo_id INTO v_vistas, v_last
    FROM public.stage_job_posted_at_repair(v_cursor, 4000) s;
    EXIT WHEN coalesce(v_vistas, 0) = 0;
    v_cursor := v_last;
  END LOOP;

  -- Se corta por filas CONSIDERADAS, no por filas escritas: un lote entero
  -- puede fallar la guarda de concurrencia sin que eso signifique que ya no
  -- queda trabajo pendiente más adelante en la cola.
  LOOP
    SELECT a.consideradas, a.vacantes, a.senales INTO v_cons, v_jobs, v_sig
    FROM public.apply_job_posted_at_repair(4000) a;
    EXIT WHEN coalesce(v_cons, 0) = 0;
    v_total_jobs := v_total_jobs + v_jobs;
    v_total_sig  := v_total_sig + v_sig;
  END LOOP;

  RAISE NOTICE 'backfill posted_at: % vacantes, % señales', v_total_jobs, v_total_sig;
END $do$;
