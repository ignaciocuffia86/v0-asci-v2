# Plan de Mejoras: Cron process-queue

## Diagnostico del Bug Actual

### Sintomas
- Batch `f5f67774` (840 filas) lleva 3+ horas sin avanzar
- Cada ejecucion del cron tarda ~31 segundos y reporta `records_processed: 0`
- El error es: `"canceling statement due to statement timeout"`
- `consecutive_failures` sigue en 0 (no se incrementa correctamente)

### Root Cause
El rol `authenticator` de PostgREST tiene `statement_timeout = 8s`. Toda RPC
llamada via `supabase.rpc()` (que pasa por PostgREST) hereda este timeout.
La RPC `process_import_batch` con 5 filas tarda ~6-10s dependiendo de la
complejidad del contacto. Al agregar procesos al diccionario (Compliance/Reclamos
= +29 keywords), el regex matching paso de ~6s a >8s por batch, superando el
timeout de Postgres.

**El fetch timeout de 25s que configuramos en el cliente Supabase es irrelevante**
porque Postgres mata la query a los 8s, mucho antes.

### Evidencia
- Batch anterior (`8ab6faee`, 3-Mar) funciono: calls de 3-10s, procesando 30-55 filas/min
- Batch actual (`f5f67774`, 4-Mar) falla 100%: TODAS las calls exceden 8s
- Diferencia: se agregaron ~29 keywords al `dictionary_patterns_cache` entre ambos
- Benchmark manual: 1 fila = 120ms (directo SQL, sin PostgREST timeout)
- Benchmark manual: 5 filas = 6.5s (directo SQL, bajo el timeout)
- Via cron/PostgREST: 5 filas > 8s (timeouts por overhead de PostgREST + session setup)

### Bug Secundario: consecutive_failures no se incrementa
El counter deberia subir a 5 y skipear el batch, pero se queda en 0.
Esto es porque nuestros benchmarks manuales procesaron 6 filas exitosamente,
y el cron al ver `processedThisCall > 0` reseteo el counter a 0.
Sin esa intervencion manual, el counter subiria a 5 y se skipearia, pero
el batch quedaria abandonado sin completar.

---

## Plan de Mejoras

### Fix 1: Timeout de la RPC (CRITICO - resolver el bug inmediato)

**Problema:** `statement_timeout = 8s` del rol `authenticator` mata la RPC.

**Solucion:** Hacer `process_import_batch` y `process_contact_batch_internal` 
con `SET statement_timeout = '60s'` en la definicion de la funcion.

```sql
CREATE OR REPLACE FUNCTION process_import_batch(...)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'  -- Override del timeout de 8s de PostgREST
AS $$ ... $$;

CREATE OR REPLACE FUNCTION process_contact_batch_internal(...)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$ ... $$;
```

Esto overridea el `statement_timeout` SOLO para estas funciones, sin afectar
ninguna otra query de la plataforma. Es el fix mas quirurgico y seguro.

**Impacto:** Las RPCs podran ejecutar hasta 60s sin ser canceladas.
Con el benchmark de ~1.3s/fila, 5 filas = ~6.5s, bien dentro del limite.

**Riesgo:** Bajo. Solo afecta estas 2 funciones. Si una query realmente cuelga,
el fetch timeout de 25s del cliente JS la cortara igualmente.

---

### Fix 2: Reducir chunk_size como safety margin (CRITICO)

**Problema:** 5 filas tardan ~6.5s en promedio, pero con varianza alta (hasta 10s
para filas con muchas previous_positions y campos largos de headline/about).

**Solucion:** Reducir `CHUNK_SIZE` de 5 a 3.

```ts
const CHUNK_SIZE = 3  // era 5
```

**Impacto:** 3 filas ~= 3.9s por call, muy por debajo de cualquier timeout.
El throughput total baja levemente (mas roundtrips) pero la consistencia sube.
Con TIME_BUDGET de 45s y calls de ~4s, se hacen ~11 calls = ~33 filas por
ejecucion de cron (vs ~30-55 filas antes con chunk=5 que funcionaba).

---

### Fix 3: Optimizar process_contact_signals (PERFORMANCE - Alto impacto)

**Problema:** Por cada contacto, se ejecutan 79 regex patterns contra 3 campos
(title, headline, about) para current position, y 1 campo (title) por cada
previous position. Total: 79 patterns x (3 + N_prev) = 237-553 evaluaciones regex.

Ademas, cuando un pattern matchea, se hace un SEGUNDO regex scan per-keyword
para encontrar cual keyword especifico matcheo:
```sql
SELECT kw INTO v_matched_kw
FROM unnest(v_dict.keywords) kw
WHERE v_fields[i] ~* ('\y' || escape_regex(kw) || '\y')
LIMIT 1;
```
Con patterns de 169 keywords, esto es otro scan de 169 regex evaluaciones.

**Solucion - Fase 1 (Quick win):** Pre-filtro con ILIKE antes del regex.

En vez de correr el regex pesado contra todos los patterns, hacer un pre-check
con `POSITION()` o `ILIKE` usando la primera keyword (que es el nombre del
diccionario, siempre presente en el campo):

```sql
-- Antes (actual): corre regex contra TODOS los patterns
FOR v_dict IN SELECT * FROM dictionary_patterns_cache
LOOP
  IF v_fields[i] ~* v_dict.pattern THEN  -- REGEX costoso, siempre se ejecuta
    ...

-- Despues: pre-filtrar con check barato
FOR v_dict IN SELECT * FROM dictionary_patterns_cache
LOOP
  -- Quick check: si el campo no contiene ninguna keyword del diccionario
  -- en texto plano, saltearlo sin correr el regex
  IF NOT EXISTS (
    SELECT 1 FROM unnest(v_dict.keywords) kw 
    WHERE v_fields[i] ILIKE '%' || kw || '%' 
    LIMIT 1
  ) THEN
    CONTINUE;
  END IF;
  -- Solo corre el regex si el ILIKE pre-filtro matcheo
  IF v_fields[i] ~* v_dict.pattern THEN
    ...
```

**Impacto estimado:** La mayoria de los patterns NO matchean contra un campo
dado (un contact que trabaja en "SAP" no matchea con "Ruby on Rails"). El
ILIKE es ~10x mas rapido que regex con alternations. Esto eliminaria ~90%
de las evaluaciones regex, reduciendo el tiempo por contacto de ~1.3s a ~200ms.

**Solucion - Fase 2 (Mayor ganancia):** Eliminar el segundo regex scan.

Cuando el pattern matchea, en vez de escanear 169 keywords individualmente,
usar `regexp_matches` para capturar el grupo y luego buscar en el array:

```sql
-- Antes: N regex scans para encontrar CUAL keyword matcheo
SELECT kw INTO v_matched_kw FROM unnest(v_dict.keywords) kw
WHERE v_fields[i] ~* ('\y' || escape_regex(kw) || '\y') LIMIT 1;

-- Despues: extraer el match directamente del regex original
-- Cambiar el pattern de \y(kw1|kw2|kw3)\y a \y(kw1|kw2|kw3)\y (ya lo es)
-- y capturar el grupo
SELECT (regexp_matches(v_fields[i], v_dict.pattern, 'i'))[1] INTO v_matched_kw;
```

**Impacto estimado:** Elimina hasta 169 regex evaluaciones por match, reemplazandolas
con 1 sola captura del grupo. Reduce ~50% del tiempo total de signal processing.

**Solucion - Fase 3 (Optimizacion avanzada):** Unificar todos los patterns en 1 solo.

En vez de 79 patterns individuales, crear un mega-pattern que matchee contra
todos al mismo tiempo, con named groups o un mapping post-match:

```sql
-- Un solo regex scan en vez de 79
v_mega_pattern := build_mega_pattern(); -- cacheable
IF v_field ~* v_mega_pattern THEN
  -- Match found, ahora identificar cual diccionario matcheo
  -- usando un mapping keyword -> dict_id pre-computado
```

**Impacto estimado:** Reduce de 79 evaluaciones a 1 por campo. Dramatico en
performance. Complejidad: Alta (requiere rebuild del cache y mapping).

---

### Fix 4: Mejorar el error handling del consecutive_failures (MEDIO)

**Problema:** El counter se resetea incorrectamente porque:
1. La condicion `processedThisCall > 0` resetea el counter, pero en la
   ejecucion actual `processedThisCall` viene del RPC result, que nunca
   tiene progreso cuando falla (siempre es 0)
2. Sin embargo, una intervencion manual (benchmark SQL directo) puede
   procesar filas, y luego el cron al verificar pending las encuentra
   como processed y no entra en error

**Solucion:** No resetear `consecutive_failures` en el cron basandose en
`processedThisCall`. Solo resetear cuando el batch se completa exitosamente.
Ademas, usar `UPDATE SET consecutive_failures = consecutive_failures + 1`
en vez de leer el valor y sumar en JS (race condition si hay 2 crons).

```ts
// Antes:
.update({ consecutive_failures: (batch.consecutive_failures || 0) + 1 })

// Despues: usar raw SQL para atomic increment
await supabase.rpc('increment_batch_failures', { p_batch_id: batch.id })
```

O simplemente:
```ts
// Actualizar basado en DB value, no en JS cache
const { data: updated } = await supabase
  .from("import_batches")
  .update({ 
    consecutive_failures: batch.consecutive_failures + 1,
    last_error: rpcError.message 
  })
  .eq("id", batch.id)
  .eq("consecutive_failures", batch.consecutive_failures) // optimistic lock
  .select("consecutive_failures")
  .single()
```

---

### Fix 5: Guard contra cron executions fantasma (BAJO)

**Problema:** Hay un `process-dictionary` "running" hace 6 dias que nunca
se limpio. El process-queue tiene cleanup de 2 minutos, pero el
process-dictionary no.

**Solucion:** Aplicar el mismo patron de cleanup al process-dictionary cron,
o hacer un cleanup global en ambos crons:

```ts
// Al inicio de cada cron: limpiar TODOS los running > 5 min
await supabase
  .from("cron_executions")
  .update({ status: "failed", completed_at: new Date().toISOString(), error_message: "Stale execution cleanup" })
  .eq("status", "running")
  .lt("started_at", new Date(Date.now() - 300_000).toISOString())
```

---

## Orden de Implementacion Recomendado

### Fase 1: Fix inmediato (desbloquear el batch actual)
1. **Fix 1** - SET statement_timeout = '60s' en las RPCs
2. **Fix 2** - Reducir CHUNK_SIZE de 5 a 3

Con estos 2 cambios, el batch actual se desbloquearia inmediatamente.
Tiempo estimado de procesamiento: 834 filas / 3 filas per call / ~4s per call
= ~278 calls. Con TIME_BUDGET de 45s y ~11 calls por ejecucion = ~25 ejecuciones
= ~25 minutos para completar el batch.

### Fase 2: Optimizacion de performance
3. **Fix 3 Fase 1** - Pre-filtro ILIKE en process_contact_signals
4. **Fix 3 Fase 2** - regexp_matches para capturar keyword directamente
5. **Fix 4** - Mejorar consecutive_failures con atomic increment

Con el pre-filtro ILIKE, el tiempo por fila bajaria de ~1.3s a ~200ms.
3 filas = ~600ms por call. Se podrian subir a CHUNK_SIZE=10 sin riesgo.
834 filas / 10 = 84 calls. Con ~75 calls per cron run (45s / 600ms) = 
~2 ejecuciones = ~2 minutos para completar todo el batch.

### Fase 3: Robustez
6. **Fix 5** - Cleanup global de executions fantasma
7. **Fix 3 Fase 3** - Mega-pattern unificado (solo si el volumen lo justifica)

---

## Metricas de Exito

| Metrica | Antes (roto) | Fase 1 | Fase 2 |
|---------|-------------|--------|--------|
| Filas por call RPC | 0 (timeout) | ~3 | ~10 |
| Tiempo por call | >8s (killed) | ~4s | ~600ms |
| Filas por cron run | 0 | ~33 | ~750 |
| Tiempo total 840 filas | infinito | ~25 min | ~2 min |
| Statement timeout safety | 0% margin | 93% margin | 99% margin |
