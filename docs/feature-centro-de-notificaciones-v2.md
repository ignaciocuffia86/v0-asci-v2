# Feature: Centro de notificaciones por usuario (v2)

Fecha: 2026-08-17
Zona: **v2** (schema `public`, sidebar + `/bookmarks`, deploy `v0-asci-v2`)
Relación: **reemplaza** el feed `/movements` propuesto en
`docs/feature-movimientos-de-contactos-v2.md` §7.3 — ver §8.

---

## 1. Veredicto

**Sí, vale la pena, y probablemente más que la feature de movimientos sola.**

El razonamiento no es "una campanita queda bien". Es que v2 tiene un problema
estructural: **el dato llega de forma asincrónica y el usuario no tiene forma de
enterarse**. Hoy la única manera de descubrir que algo cambió en una cuenta es
abrir el bookmark y recorrer los 7 tabs a mano, uno por uno, sin saber cuál tiene
algo nuevo.

Y hay una segunda razón, más práctica: **media infraestructura ya está construida**
y sin usar.

---

## 2. La evidencia de que el problema es real

| Hallazgo | Dónde |
|---|---|
| **10 crons** escriben datos de cuenta de forma asincrónica, algunos cada minuto | `vercel.json` |
| El research de una cuenta tarda **549s promedio, 795s p95** | auditoría §2.1 |
| La UI **ya poletea a mano** para saber si un job async terminó: `setInterval` cada 5s con timeout de 5 min | `app/bookmarks/[id]/_components/prospects-tab.tsx:291-344` |
| El detalle de cuenta tiene **7 tabs**; nada indica cuál tiene novedades | `app/bookmarks/[id]/page.tsx:462-501` |
| El cron marca contactos con `needs_review` desde hace meses y **no se renderiza en ninguna parte** | verificado: 0 ocurrencias en `app/**/*.tsx` |
| La auditoría ya lo pide como recomendación: *"novedades no vistas"* | auditoría §11, días 31–60 |

El polling manual de `prospects-tab` es el síntoma más claro: se escribió un
mecanismo de espera ad-hoc, dentro de un tab, porque no existe un canal por donde
avisar que algo terminó.

---

## 3. Lo que ya está construido (script 102) y no se usa

El sistema de digest se removió, pero **las tablas quedaron**:

```sql
user_notification_preferences (
  user_id PRIMARY KEY,
  digest_enabled boolean DEFAULT true,
  digest_frequency text CHECK (IN ('weekly','monthly','never')),
  last_digest_sent_at timestamptz
)

user_digest_sent_items (user_id, item_type, item_id, sent_at)   -- ledger anti-duplicado
digest_send_log (user_id, items_count, companies_count, status) -- auditoría de envío
```

Es decir: **la capa de preferencias y el ledger de "ya te avisé" ya existen**.
`user_digest_sent_items` es exactamente el anti-duplicado que hace falta.

Además, `company_news` y `company_implementations` ya tienen `requested_at`,
`requested_by` y `published_at` (mismo script), así que hay marca de tiempo y de
procedencia para calcular novedades sin agregar nada.

Y el deep-link ya funciona: `app/bookmarks/[id]/page.tsx:58` lee `?tab=`, así que
una card puede llevar **al tab exacto** donde está el dato nuevo.

---

## 4. La decisión de arquitectura: watermark vs. tabla de eventos

Es la decisión que define el costo de la feature. Las dos opciones puras tienen
problemas:

| | Tabla de eventos (fan-out) | Watermark (marca de lectura) |
|---|---|---|
| Cómo funciona | Cada productor inserta una fila por usuario afectado | Se guarda "hasta acá vi" y se cuentan filas nuevas al leer |
| Hay que tocar los productores | **Sí, los 10 crons + el pipeline** | **No, ninguno** |
| Crecimiento de filas | N usuarios × M eventos | Una fila por usuario × cuenta |
| Descartar una notificación puntual | Sí | No |
| Sirve para email/push | Sí | Difícil |
| Granularidad | Una card por hecho | "3 noticias nuevas" |

El riesgo de la tabla de eventos no es teórico: `public.cron_executions` ya tiene
**~1,3M de filas** por un log mucho más simple. Un fan-out por usuario sin política
de retención repite ese problema, y además obliga a modificar 10 productores que
hoy funcionan.

### Recomendación: híbrido, y la línea divisoria es clara

> **Watermark** para datos de volumen. **Evento** para hechos puntuales y accionables.

- **Watermark** → noticias, señales, vacantes, findings del radar. Nadie quiere una
  card por cada vacante: quiere *"Cencosud: 4 vacantes nuevas"*. Se calcula al leer,
  no toca ningún productor, no crece.
- **Evento** → movimiento de contacto detectado, research terminado, enrichment
  completo, cuenta refrescada. Son hechos únicos, accionables, que se descartan de a
  uno y que valen un email.

Con eso, la fase 1 **no toca ningún cron existente** y ya entrega el 70% del valor.

---

## 5. Modelo de datos

### 5.1 Watermark

```sql
CREATE TABLE IF NOT EXISTS public.user_account_watermarks (
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bookmark_id uuid NOT NULL REFERENCES public.bookmarks(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  -- opcional: por tab, para marcar sólo lo que realmente miró
  seen_by_tab jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (user_id, bookmark_id)
);

ALTER TABLE public.user_account_watermarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own watermarks" ON public.user_account_watermarks
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

Y una RPC que devuelve el resumen de novedades por cuenta:

```sql
CREATE OR REPLACE FUNCTION public.get_account_updates(p_user_id uuid)
RETURNS TABLE (
  bookmark_id uuid, company_id uuid, company_name text,
  news_count int, signals_count int, jobs_count int, radar_count int,
  last_update_at timestamptz
) LANGUAGE sql SECURITY DEFINER AS $$
  -- cuenta filas creadas después de last_seen_at en cada productor,
  -- para los bookmarks del usuario
$$;
```

`SECURITY DEFINER` con filtro explícito por `p_user_id`, siguiendo el patrón de
`get_prospects_for_icebreakers` (script 098).

### 5.2 Eventos

```sql
CREATE TABLE IF NOT EXISTS public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bookmark_id uuid REFERENCES public.bookmarks(id) ON DELETE CASCADE,
  company_id  uuid REFERENCES public.companies(id) ON DELETE CASCADE,

  kind text NOT NULL CHECK (kind IN (
    'contact_movement',     -- de la feature de Movimientos
    'research_completed',   -- terminó un job async que el usuario disparó
    'enrichment_completed', -- Apollo devolvió teléfono/contactos
    'account_refreshed',    -- se refrescó el dato de la cuenta
    'contact_needs_review'  -- el contacto quedó marcado para revisar
  )),

  title text NOT NULL,
  body  text,
  deep_link text NOT NULL,       -- ej: /bookmarks/{id}?tab=prospects
  payload jsonb,                 -- ids de las entidades involucradas

  status text NOT NULL DEFAULT 'unread'
    CHECK (status IN ('unread','read','dismissed')),
  emailed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  dedupe_key text NOT NULL,
  UNIQUE (user_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_inbox
  ON public.user_notifications (user_id, status, created_at DESC)
  WHERE status <> 'dismissed';

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own notifications" ON public.user_notifications
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

**Retención desde el día uno** (la lección de `cron_executions`): el cron semanal
`/api/cron/cleanup` borra `dismissed` con más de 30 días y cualquier notificación
con más de 90. Se agrega en el mismo handler que ya existe.

Archivo: **`scripts/503_notifications.sql`** (después del `502` de Movimientos).

---

## 6. Catálogo de notificaciones

| Tipo | Mecanismo | Granularidad | Card |
|---|---|---|---|
| Noticias nuevas | watermark | agregada por cuenta | "Cencosud · 3 noticias nuevas" → `?tab=news` |
| Vacantes nuevas | watermark | agregada | "Falabella · 4 vacantes nuevas" → `?tab=jobpostings` |
| Señales / radar | watermark | agregada | "Arcor · 2 implementaciones detectadas" → `?tab=intelligence` |
| **Movimiento de contacto** | evento | individual | "Juan Pérez pasó de Falabella a Cencosud" → `?tab=prospects` |
| Research terminado | evento | individual | "Listo el análisis de Despegar" → `?tab=summary` |
| Enrichment completo | evento | individual | "3 contactos nuevos en Arcor" → `?tab=prospects` |
| Contacto a revisar | evento | individual | "El email de M. Gómez dejó de estar verificado" |

Los tres de evento cubren justo lo que hoy se resuelve con polling manual o no se
resuelve.

---

## 7. UI

### 7.1 Campanita en el sidebar

`components/main-sidebar.tsx` tiene los ítems de nav (`/search`, `/bookmarks`,
`/docs`, `/profile`). La campanita va en el header del sidebar con un badge de no
leídas, y abre un panel (`Popover` o `Sheet` en mobile — ambos ya están en
`components/ui/`).

No hace falta una página nueva: **el panel es la feature**. Si más adelante crece,
`/notifications` con historial completo.

### 7.2 Anatomía de la card

```
┌──────────────────────────────────────────────┐
│ [avatar/logo]  Cencosud                      │
│ 3 noticias nuevas · 1 vacante                │
│ "Cencosud anuncia inversión en su plataforma"│
│ hace 2 horas          [Ver novedades →]      │
└──────────────────────────────────────────────┘
```

El botón lleva a `/bookmarks/{id}?tab=news`, que **ya funciona** sin tocar nada
(`page.tsx:58`). Al abrir, se actualiza el watermark de ese tab y la card
desaparece sola.

### 7.3 Indicador por tab

El mismo cálculo del watermark alimenta un puntito en los `TabsTrigger` que tienen
novedades. Es el que resuelve el problema de fondo —"¿en qué tab está lo nuevo?"—
y sale gratis una vez que existe la RPC.

### 7.4 Anti-fatiga

- **Agrupar por cuenta**, nunca una card por hecho de volumen.
- **Preferencias por tipo**, extendiendo `user_notification_preferences` (que ya
  existe) con un `jsonb` de tipos habilitados en vez de una tabla nueva.
- **Tope** de cards en el panel; el resto en "ver todas".
- El email semanal se arma con las mismas notificaciones, usando
  `user_digest_sent_items` como ledger para no repetir lo ya avisado.

---

## 8. Cómo se integra con la feature de Movimientos

**Recomendación: no construir las dos bandejas.** El feed `/movements` que propuse
en el doc anterior (§7.3) es un caso particular de esto. La versión corregida:

| Antes | Ahora |
|---|---|
| Feed `/movements` en el sidebar | **Se descarta.** Los movimientos son `kind = 'contact_movement'` en el centro de notificaciones |
| `user_contact_movements.status` | Se mantiene: es el estado *comercial* del movimiento (`actioned`, `dismissed`), distinto del estado de *lectura* de la notificación |
| Tab "Movimientos" en el bookmark | **Se mantiene.** Es la vista histórica por cuenta; el panel es la bandeja transversal |

O sea: la feature de Movimientos aporta el **detector y el hecho**; el centro de
notificaciones aporta el **canal**. `fanOutMovement()` pasa a insertar en
`user_notifications` además de en `user_contact_movements`.

Eso simplifica el plan anterior: **la fase 2 de Movimientos deja de existir** y se
absorbe acá.

---

## 9. Fases

| # | Alcance | Toca productores | Esfuerzo |
|---|---|---|---|
| **1** | Watermark + RPC `get_account_updates` + campanita + cards agregadas + puntito por tab | **Ninguno** | **3–4 días** |
| **2** | `user_notifications` + eventos de research/enrichment + retención en `cleanup` | Sólo los puntos donde termina un job | 3 días |
| **3** | `contact_movement` conectado (depende de la fase 1 de Movimientos) | — | 1 día |
| **4** | Email semanal reusando `user_notification_preferences` + `user_digest_sent_items` + `app/actions/resend.ts` | — | 2–3 días |
| **5** | Realtime opcional (Supabase Realtime) para que la campanita se actualice sin refresh, y **borrar el polling de `prospects-tab`** | — | 2 días |

La fase 1 es la que más rinde: no toca ningún cron, no agrega filas, y ya resuelve
"¿qué cambió en mis cuentas?".

---

## 10. Riesgos y decisiones abiertas

| Riesgo | Mitigación |
|---|---|
| **Costo de la RPC de watermark.** Contar filas en 4–5 tablas por bookmark en cada render. | Índices por `(company_id, created_at)` — ya existen para news e implementations (script 102). Si con volumen real no alcanza, contador materializado. **Medir antes de optimizar.** |
| **Fatiga de notificaciones.** | Agrupación por cuenta + preferencias por tipo + tope en el panel. |
| **Crecimiento de `user_notifications`.** | Retención desde el día uno en `/api/cron/cleanup`, que ya corre semanal. |
| **Ruido en usuarios con muchos bookmarks.** | Ordenar por `priority` del bookmark (`alta` primero): el campo ya existe en `public.bookmarks`. |

### Decisiones tomadas (2026-08-17)

1. **Watermark por cuenta**, no por tab. Se descarta `seen_by_tab` en fase 1.
2. **Panel en la campanita.** Sin página `/notifications`.
3. **Sin email.** Primero medir si el panel se usa.

La spec de construcción con estas decisiones está en §11.

---

## 11. Especificación de construcción — Fase 1

Decisiones cerradas: **watermark por cuenta, panel en la campanita, sin email.**

### 11.1 Volumen real (medido en producción, 2026-08-17)

| Tabla | Filas totales | Últimos 30 días |
|---|---:|---:|
| `signals` | **1.694.025** | **189.914** |
| `job_postings` | 41.224 | 7.767 |
| `company_news` | 1.133 | — |
| `company_implementations` | 727 | — |
| `radar_findings` | 706 | 310 |
| `bookmarks` | 2.322 (67 usuarios) | — |

Bookmarks por usuario: **promedio 35, p90 108, máximo 411**.

### 11.2 Consecuencia: `signals` queda afuera

190 mil filas en 30 días es un **firehose del ETL**, no una novedad comercial: las
señales se generan cuando se ingestan contactos y vacantes, no cuando pasa algo en
la cuenta. Contarlas produciría cards del tipo *"Arcor · 4.812 señales nuevas"*, que
es ruido puro.

Además `signals` no tiene índice compuesto `(company_id, created_at)` — sólo
`idx_signals_company_id` (script 001) — así que contar por fecha sobre 1,7M de
filas sería el único riesgo de performance de toda la feature.

**Fase 1 cuenta cuatro productores: noticias, implementaciones, vacantes y radar.**
Las señales, si alguna vez entran, lo hacen agregadas por diccionario
(*"3 tecnologías nuevas detectadas"*), no por fila.

Con esos cuatro, el peor caso —un usuario con 411 bookmarks— cuenta sobre tablas de
41k, 1,1k, 727 y 706 filas, todas indexadas por la clave de acceso. No hace falta
contador materializado.

### 11.3 Migración: `scripts/503_notifications_watermarks.sql`

```sql
-- 1. Tabla de watermarks (una fila por usuario × cuenta)
create table if not exists public.user_account_watermarks (
  user_id      uuid not null references auth.users(id) on delete cascade,
  bookmark_id  uuid not null references public.bookmarks(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, bookmark_id)
);

create index if not exists idx_watermarks_user
  on public.user_account_watermarks (user_id);

alter table public.user_account_watermarks enable row level security;

drop policy if exists "own watermarks" on public.user_account_watermarks;
create policy "own watermarks" on public.user_account_watermarks
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);   -- WITH CHECK explícito (auditoría P0.4)
```

```sql
-- 2. Índices que faltan en los productores.
--    CONCURRENTLY no corre dentro de una transacción: este bloque va en un
--    archivo aparte o se ejecuta suelto (precedente: script 165).
create index concurrently if not exists idx_job_postings_company_created
  on public.job_postings (company_id, created_at desc);

create index concurrently if not exists idx_company_news_bookmark_created
  on public.company_news (bookmark_id, created_at desc);

create index concurrently if not exists idx_company_impl_bookmark_created
  on public.company_implementations (bookmark_id, created_at desc);

-- radar_findings ya tiene (company_id, detected_at desc) — script 400
```

```sql
-- 3. RPC de novedades
create or replace function public.get_account_updates(p_limit int default 100)
returns table (
  bookmark_id    uuid,
  company_id     uuid,
  company_name   text,
  priority       text,
  since          timestamptz,
  news_count     int,
  impl_count     int,
  jobs_count     int,
  radar_count    int,
  total_count    int,
  last_update_at timestamptz
)
language sql
stable
security definer          -- obligatorio: radar_findings sólo es legible por service_role
set search_path = public  -- evita search_path hijacking
as $$
  with mine as (
    select
      b.id as bookmark_id,
      b.company_id,
      b.priority,
      coalesce(w.last_seen_at, b.created_at) as since
    from public.bookmarks b
    left join public.user_account_watermarks w
      on w.bookmark_id = b.id and w.user_id = b.user_id
    where b.user_id = auth.uid()          -- nunca un parámetro: no se puede suplantar
  ),
  counted as (
    select
      m.*,
      (select count(*) from public.company_news n
         where n.bookmark_id = m.bookmark_id and n.created_at > m.since) as news_count,
      (select count(*) from public.company_implementations i
         where i.bookmark_id = m.bookmark_id and i.created_at > m.since) as impl_count,
      (select count(*) from public.job_postings j
         where j.company_id = m.company_id and j.created_at > m.since) as jobs_count,
      (select count(*) from public.radar_findings r
         where r.company_id = m.company_id and r.detected_at > m.since) as radar_count,
      greatest(
        coalesce((select max(n.created_at) from public.company_news n
                   where n.bookmark_id = m.bookmark_id and n.created_at > m.since), m.since),
        coalesce((select max(i.created_at) from public.company_implementations i
                   where i.bookmark_id = m.bookmark_id and i.created_at > m.since), m.since),
        coalesce((select max(j.created_at) from public.job_postings j
                   where j.company_id = m.company_id and j.created_at > m.since), m.since),
        coalesce((select max(r.detected_at) from public.radar_findings r
                   where r.company_id = m.company_id and r.detected_at > m.since), m.since)
      ) as last_update_at
    from mine m
  )
  select
    c.bookmark_id, c.company_id, co.name, c.priority, c.since,
    c.news_count::int, c.impl_count::int, c.jobs_count::int, c.radar_count::int,
    (c.news_count + c.impl_count + c.jobs_count + c.radar_count)::int as total_count,
    c.last_update_at
  from counted c
  join public.companies co on co.id = c.company_id
  where (c.news_count + c.impl_count + c.jobs_count + c.radar_count) > 0
  order by
    case c.priority when 'alta' then 0 when 'transaccional' then 1 else 2 end,
    c.last_update_at desc
  limit p_limit;
$$;

revoke all on function public.get_account_updates(int) from public;
grant execute on function public.get_account_updates(int) to authenticated;
```

> **Nota de seguridad:** el `auth.uid()` va *dentro* de la función, no como
> parámetro. Es más estricto que `get_prospects_for_icebreakers(p_bookmark_id,
> p_user_id)` (script 098), que confía en un `user_id` que manda el cliente.

```sql
-- 4. Marcar cuenta como vista (upsert idempotente)
create or replace function public.mark_account_seen(p_bookmark_id uuid)
returns timestamptz            -- devuelve el watermark ANTERIOR
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous timestamptz;
begin
  select coalesce(w.last_seen_at, b.created_at) into v_previous
  from public.bookmarks b
  left join public.user_account_watermarks w
    on w.bookmark_id = b.id and w.user_id = b.user_id
  where b.id = p_bookmark_id and b.user_id = auth.uid();

  if v_previous is null then
    raise exception 'bookmark no encontrado o no pertenece al usuario';
  end if;

  insert into public.user_account_watermarks (user_id, bookmark_id, last_seen_at, updated_at)
  values (auth.uid(), p_bookmark_id, now(), now())
  on conflict (user_id, bookmark_id)
  do update set last_seen_at = now(), updated_at = now();

  return v_previous;
end;
$$;

revoke all on function public.mark_account_seen(uuid) from public;
grant execute on function public.mark_account_seen(uuid) to authenticated;
```

### 11.4 La regla del watermark (lo más importante del diseño)

**Se lee primero, se actualiza después.** `mark_account_seen` devuelve el watermark
*anterior* justamente para eso:

1. El usuario abre `/bookmarks/{id}`.
2. La página llama `mark_account_seen(id)` → recibe `previousSeenAt` y ya deja el
   watermark en `now()`.
3. `previousSeenAt` baja por props a los tabs, que marcan como **"nuevo"** las filas
   posteriores a esa fecha.

Sin esto, abrir la cuenta borraría la novedad antes de que el usuario la vea, que es
el error clásico de esta feature.

**El trade-off aceptado de "watermark por cuenta":** abrir la cuenta marca como
vista *toda* la cuenta, incluidos los tabs que no se abrieron. Se compensa con el
resaltado por `previousSeenAt`, que sobrevive a la visita.

### 11.5 Archivos

**Nuevos**

| Archivo | Qué |
|---|---|
| `scripts/503_notifications_watermarks.sql` | Tabla + RPCs + grants |
| `scripts/504_notifications_indexes.sql` | Los 3 `CREATE INDEX CONCURRENTLY` (fuera de transacción) |
| `app/actions/notifications.ts` | `getAccountUpdates()`, `markAccountSeen(bookmarkId)` |
| `components/notifications/notification-bell.tsx` | Campanita + badge + `Popover` |
| `components/notifications/notification-card.tsx` | Card de cuenta con deep-link |
| `hooks/use-account-updates.ts` | SWR con `refreshInterval: 60_000` |

**Modificados**

| Archivo | Cambio |
|---|---|
| `components/main-sidebar.tsx` | Montar `<NotificationBell />` en el header del sidebar y en la barra mobile |
| `app/bookmarks/[id]/page.tsx` | Llamar `markAccountSeen` al montar; pasar `previousSeenAt` a los tabs |
| `app/bookmarks/[id]/_components/{news,job-postings,intelligence}-tab.tsx` | Badge "nuevo" en las filas posteriores a `previousSeenAt` |
| `app/api/cron/cleanup/route.ts` | Borrar watermarks huérfanos (defensivo; el cascade ya cubre el caso normal) |

### 11.6 Contratos

```ts
// app/actions/notifications.ts
export type AccountUpdate = {
  bookmarkId: string
  companyId: string
  companyName: string
  priority: "alta" | "transaccional" | "baja" | null
  since: string
  newsCount: number
  implCount: number
  jobsCount: number
  radarCount: number
  totalCount: number
  lastUpdateAt: string
}

export async function getAccountUpdates(limit = 100): Promise<AccountUpdate[]>
export async function markAccountSeen(bookmarkId: string): Promise<string> // previousSeenAt
```

**Deep-link por productor dominante** (el de mayor conteo define el tab destino):

| Productor | Destino |
|---|---|
| `newsCount` | `/bookmarks/{id}?tab=news` |
| `implCount` / `radarCount` | `/bookmarks/{id}?tab=intelligence` |
| `jobsCount` | `/bookmarks/{id}?tab=jobpostings` |

`?tab=` ya funciona sin tocar nada (`app/bookmarks/[id]/page.tsx:58`).

### 11.7 Copy de las cards

```
Cencosud                                    hace 2 h
3 noticias · 1 vacante                   [Ver novedades →]

Falabella                                   ayer
4 vacantes nuevas                        [Ver novedades →]

Arcor                                       hace 3 días
2 implementaciones detectadas            [Ver novedades →]
```

Sin cuentas con novedades: *"Estás al día. Te avisamos cuando haya algo nuevo en
tus cuentas guardadas."*

Badge de la campanita = **cantidad de cuentas con novedades**, no la suma de hechos
(un badge en "47" por 47 vacantes de una sola cuenta es ansiedad, no información).

### 11.8 Casos borde

| Caso | Comportamiento |
|---|---|
| Bookmark sin watermark (nunca abierto) | `since = bookmarks.created_at`: lo anterior a guardarlo no cuenta como novedad |
| Usuario con 411 bookmarks | `p_limit` + orden por `priority` y recencia; el panel muestra top 10 con "ver todas" |
| `created_at` nulo en news/implementations | La comparación `> since` lo descarta. Aceptable: son filas viejas anteriores al default |
| Bookmark borrado | `on delete cascade` limpia el watermark |
| Dato creado por el propio usuario (`requested_by = él`) | **Cuenta igual**: pidió un research asincrónico y el aviso de que terminó es justamente el valor |
| Dos pestañas abiertas | El upsert es idempotente; gana el `now()` más reciente |

### 11.9 Plan de prueba

- **SQL**: correr `get_account_updates()` como un usuario real con `EXPLAIN ANALYZE`
  antes y después de los índices. Objetivo: **< 200 ms** para el usuario de 411 bookmarks.
- **Unit (vitest)**: la lógica de derivación de la card — tab destino según el
  productor dominante, armado del copy, pluralización. Es lo único puro que hay.
- **Manual**: bookmarkear una cuenta, insertar una noticia con fecha posterior,
  verificar que la card aparece, abrir la cuenta, verificar que las filas nuevas
  quedan resaltadas y que la card desaparece al recargar.
- **RLS**: con dos usuarios, confirmar que `get_account_updates()` nunca devuelve
  bookmarks ajenos y que `mark_account_seen` de un bookmark ajeno tira excepción.

### 11.10 Definition of done

- [ ] `503` y `504` aplicados; `EXPLAIN ANALYZE` bajo 200 ms en el peor caso
- [ ] Campanita visible en desktop y mobile, con badge por cantidad de cuentas
- [ ] Card lleva al tab correcto y la cuenta se marca como vista
- [ ] Las filas nuevas quedan resaltadas usando `previousSeenAt` en esa misma visita
- [ ] Estado vacío implementado
- [ ] Test de RLS con dos usuarios en verde
- [ ] `pnpm typecheck` y `pnpm test` en verde

**Estimación: 3–4 días.** No toca ningún cron y no agrega filas por evento.
