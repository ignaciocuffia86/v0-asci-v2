# Plan de Mejoras: Dashboard de Salud de la Plataforma v2

> **Fecha de creación**: 16 de enero 2026
> **Estado**: Pendiente de implementación
> **Prioridad**: Media-Alta

---

## Contexto del Problema

El dashboard actual en `/admin/processing` tiene múltiples problemas:

1. **Señales con cap de 1000**: Supabase default limit impide ver el total real (221,317 señales)
2. **Jobs pendientes incorrectos**: El tab Diccionario muestra 0 cuando hay 667 pendientes reales
3. **Import Batches incompleto**: No diferencia tipos, no muestra señales generadas
4. **CRONs sin tracking**: No hay forma de saber cuándo se ejecutaron ni su estado
5. **Logs con auto-refresh**: Rompe el scroll, no permite revisar eventos anteriores
6. **Sin métricas de imports**: No sabemos cuántas señales genera cada import

---

## Datos Recopilados

### Estructura Actual de Tablas

#### `dictionary_jobs`
| Columna | Tipo | Notas |
|---------|------|-------|
| id | uuid | PK |
| job_type | text | 'add_keyword' / 'remove_keyword' |
| signal_type | text | 'process' / 'technology' |
| signal_id | uuid | FK a dictionary_processes/products |
| keyword | text | |
| status | text | 'pending', 'processing', 'completed', 'failed' |
| phase | text | |
| progress | integer | |
| processed_records | integer | |
| total_records | integer | |
| error_message | text | |
| created_at | timestamptz | ✅ |
| started_at | timestamptz | ✅ |
| completed_at | timestamptz | ✅ |

#### `import_batches`
| Columna | Tipo | Notas |
|---------|------|-------|
| id | uuid | PK |
| user_id | uuid | |
| batch_type | text | 'contacts' / 'job_postings' |
| file_name | text | |
| total_rows | integer | |
| processed_rows | integer | **Siempre en 0 - BUG** |
| failed_rows | integer | |
| status | text | |
| error_message | text | |
| created_at | timestamptz | ✅ |
| updated_at | timestamptz | ✅ |
| **started_at** | - | **FALTA** |
| **completed_at** | - | **FALTA** |
| **signals_created** | - | **FALTA** |

#### `signals`
| Columna | Tipo | Notas |
|---------|------|-------|
| id | uuid | PK |
| signal_type | text | 'process' / 'technology' |
| signal_id | uuid | FK |
| keyword_matched | text | |
| source_field | text | |
| snippet | text | |
| company_id | uuid | |
| contact_id | uuid | |
| created_at | timestamptz | ✅ |
| **updated_at** | - | No necesario |

#### `dictionary_processes` / `dictionary_products`
| Columna | Tipo | Notas |
|---------|------|-------|
| id | uuid | PK |
| name | text | |
| keywords | text[] | |
| created_at | timestamptz | ✅ |
| **updated_at** | - | **FALTA** - no sabemos cuándo se modificaron keywords |

#### `debug_events`
| Columna | Tipo | Notas |
|---------|------|-------|
| id | uuid | PK |
| event_type | text | Genérico, no estructurado |
| details | jsonb | |
| created_at | timestamptz | |

### Métricas Reales del Sistema (16/01/2026)

| Métrica | Valor Real | Valor Mostrado |
|---------|------------|----------------|
| Señales totales | 221,317 | 1,000 (cap) |
| Señales process | 77,168 | - |
| Señales technology | 144,149 | - |
| Jobs pending | 667 | 0 |
| Jobs processing | 0 | - |
| Jobs completed | 2,288 | - |
| Jobs failed | 2 | - |

### CRONs Configurados (vercel.json)

| CRON | Schedule | Endpoint |
|------|----------|----------|
| process-queue | */5 * * * * | /api/cron/process-queue |
| process-dictionary | */5 * * * * | /api/cron/process-dictionary |
| monitor | */15 * * * * | /api/cron/monitor |
| sync-users | 0 2 * * * | /api/sync-users |

---

## Plan de Implementación

### FASE 1: Nuevas Tablas y Modificaciones de Schema

#### 1.1 Nueva tabla `cron_executions`

```sql
CREATE TABLE cron_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cron_name TEXT NOT NULL,           -- 'process-queue', 'process-dictionary', 'monitor', 'sync-users'
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'running',     -- 'running', 'completed', 'failed'
  records_processed INTEGER DEFAULT 0,
  records_failed INTEGER DEFAULT 0,
  signals_created INTEGER DEFAULT 0,
  error_message TEXT,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_cron_executions_name ON cron_executions(cron_name);
CREATE INDEX idx_cron_executions_started ON cron_executions(started_at DESC);
```

**Beneficio**: Tracking exacto de cada ejecución de CRON con métricas.

#### 1.2 Modificar `import_batches`

```sql
ALTER TABLE import_batches ADD COLUMN started_at TIMESTAMPTZ;
ALTER TABLE import_batches ADD COLUMN completed_at TIMESTAMPTZ;
ALTER TABLE import_batches ADD COLUMN signals_created INTEGER DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN contacts_created INTEGER DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN contacts_updated INTEGER DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN companies_created INTEGER DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN processing_phase TEXT DEFAULT 'pending';
  -- 'pending', 'processing_rows', 'generating_signals', 'completed', 'failed'
```

**Beneficio**: Métricas detalladas de cada import, incluyendo señales generadas.

#### 1.3 Modificar diccionarios (agregar updated_at)

```sql
ALTER TABLE dictionary_processes ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE dictionary_products ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();

-- Trigger para auto-update
CREATE OR REPLACE FUNCTION update_dictionary_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_dictionary_processes_updated
  BEFORE UPDATE ON dictionary_processes
  FOR EACH ROW EXECUTE FUNCTION update_dictionary_timestamp();

CREATE TRIGGER trigger_dictionary_products_updated
  BEFORE UPDATE ON dictionary_products
  FOR EACH ROW EXECUTE FUNCTION update_dictionary_timestamp();
```

**Beneficio**: Saber cuándo se modificaron las keywords de cada proceso/producto.

#### 1.4 RPC para conteos eficientes (sin cap de 1000)

```sql
CREATE OR REPLACE FUNCTION get_dashboard_counts()
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'signals_total', (SELECT COUNT(*) FROM signals),
    'signals_process', (SELECT COUNT(*) FROM signals WHERE signal_type = 'process'),
    'signals_technology', (SELECT COUNT(*) FROM signals WHERE signal_type = 'technology'),
    'contacts_total', (SELECT COUNT(*) FROM contacts),
    'companies_total', (SELECT COUNT(*) FROM companies),
    'dictionary_processes', (SELECT COUNT(*) FROM dictionary_processes),
    'dictionary_products', (SELECT COUNT(*) FROM dictionary_products),
    'dictionary_vendors', (SELECT COUNT(*) FROM dictionary_vendors),
    'jobs_pending', (SELECT COUNT(*) FROM dictionary_jobs WHERE status = 'pending'),
    'jobs_processing', (SELECT COUNT(*) FROM dictionary_jobs WHERE status = 'processing'),
    'jobs_completed', (SELECT COUNT(*) FROM dictionary_jobs WHERE status = 'completed'),
    'jobs_failed', (SELECT COUNT(*) FROM dictionary_jobs WHERE status = 'failed'),
    'keywords_process', (SELECT COALESCE(SUM(array_length(keywords, 1)), 0) FROM dictionary_processes),
    'keywords_technology', (SELECT COALESCE(SUM(array_length(keywords, 1)), 0) FROM dictionary_products)
  );
$$ LANGUAGE SQL;
```

**Beneficio**: Una sola llamada retorna todos los conteos sin límite.

---

### FASE 2: Modificar CRONs para Registrar Ejecuciones

#### 2.1 `process-queue/route.ts`

```typescript
// Al inicio del CRON
const { data: execution } = await supabase
  .from('cron_executions')
  .insert({
    cron_name: 'process-queue',
    status: 'running',
    started_at: new Date().toISOString()
  })
  .select('id')
  .single();

// Durante el procesamiento - actualizar import_batches
await supabase
  .from('import_batches')
  .update({
    processing_phase: 'generating_signals',
    processed_rows: processedCount,
    signals_created: signalsCount
  })
  .eq('id', batchId);

// Al final del CRON
await supabase
  .from('cron_executions')
  .update({
    status: 'completed',
    completed_at: new Date().toISOString(),
    records_processed: totalProcessed,
    signals_created: totalSignals
  })
  .eq('id', execution.id);
```

#### 2.2 `process-dictionary/route.ts`

Similar al anterior, registrando jobs procesados.

#### 2.3 `monitor/route.ts`

Registrar cada ejecución del monitor.

---

### FASE 3: Dashboard Rediseñado

#### Cards Principales

| Card | Dato | Fuente |
|------|------|--------|
| Señales Totales | 221,317 (process: 77K, tech: 144K) | RPC `get_dashboard_counts()` |
| Contactos | 45,000 | RPC |
| Compañías | 12,000 | RPC |
| Jobs Pendientes | 667 | RPC |

#### Tab: Estado de CRONs (Real-time)

| CRON | Última Ejecución | Duración | Estado | Procesados | Señales |
|------|------------------|----------|--------|------------|---------|
| process-queue | hace 3 min | 45s | Completado | 150 rows | +230 |
| process-dictionary | hace 2 min | 1m 20s | Completado | 50 jobs | +1,200 |
| monitor | hace 12 min | 2s | Completado | - | - |
| sync-users | hace 8 horas | 3s | Completado | 5 | - |

#### Tab: Import Batches (Con métricas reales)

| Archivo | Tipo | Estado | Fase | Filas | Procesadas | Señales | Duración |
|---------|------|--------|------|-------|------------|---------|----------|
| contacts_jan.csv | contacts | Procesando | Generando señales | 6,257 | 4,500 (72%) | +890 | 2m 30s |
| jobs_dec.csv | job_postings | Completado | - | 1,710 | 1,710 | +3,400 | 5m 12s |

**Progress bar en tiempo real cuando está procesando.**

#### Tab: Diccionario

| Tipo | Cantidad | Keywords | Última Modificación |
|------|----------|----------|---------------------|
| Procesos | 45 | 892 | 16/01 15:30 |
| Productos | 120 | 2,341 | 15/01 10:00 |
| Vendors | 35 | - | - |

**Jobs**: 667 pendientes | 0 procesando | 2 fallidos

#### Tab: Logs

- Sin auto-refresh (botón manual)
- Filtros por tipo de evento
- Scroll funcional
- Orden descendente (más recientes arriba)

---

### FASE 4: Real-time Updates (Opcional)

Usar Supabase Realtime para subscribirse a:
- Cambios en `cron_executions`
- Cambios en `import_batches`
- Actualizar dashboard sin refresh manual

---

## Archivos a Crear/Modificar

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `scripts/037_dashboard_improvements.sql` | Crear | Nuevas tablas, columnas, RPCs, triggers |
| `app/api/cron/process-queue/route.ts` | Modificar | Registrar ejecuciones y métricas |
| `app/api/cron/process-dictionary/route.ts` | Modificar | Registrar ejecuciones |
| `app/api/cron/monitor/route.ts` | Modificar | Registrar ejecuciones |
| `app/actions/processing.ts` | Reescribir | Usar RPC para conteos |
| `app/admin/processing/page.tsx` | Reescribir | Nuevo diseño con métricas correctas |

---

## Estimación de Esfuerzo

| Fase | Tiempo Estimado |
|------|-----------------|
| Fase 1: Schema changes | 1-2 horas |
| Fase 2: Modificar CRONs | 2-3 horas |
| Fase 3: Dashboard UI | 3-4 horas |
| Fase 4: Real-time (opcional) | 1-2 horas |
| **Total** | **7-11 horas** |

---

## Checklist de Implementación

- [ ] Ejecutar script SQL de migración
- [ ] Modificar `process-queue/route.ts`
- [ ] Modificar `process-dictionary/route.ts`
- [ ] Modificar `monitor/route.ts`
- [ ] Crear nueva función `getDashboardStats()` usando RPC
- [ ] Rediseñar página `admin/processing`
- [ ] Agregar tab de Import Batches con progreso real
- [ ] Agregar tab de CRONs con última ejecución
- [ ] Arreglar tab de Logs (sin auto-refresh)
- [ ] Testing completo
- [ ] (Opcional) Implementar Supabase Realtime
