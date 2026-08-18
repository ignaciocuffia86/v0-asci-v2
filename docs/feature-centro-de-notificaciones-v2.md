# Feature: Centro de notificaciones por usuario (v2)

**Estado:** diseño cerrado, listo para construir
**Fecha:** 2026-08-17
**Zona:** v2 — schema `public`, sidebar + `/bookmarks`, deploy `v0-asci-v2`
**Depende de:** `docs/plan-unificacion-evidencia-v2-v3.md` (fases A–B)

> **Orden de construcción acordado:** primero el contrato de evidencia, después
> esta feature. La spec de §6 ya está escrita contra `public.company_evidence`,
> así que no hay retrabajo.

---

## 1. Qué es

Una campanita en el sidebar con un panel de cards que avisan **qué cambió en las
cuentas que el usuario tiene bookmarkeadas**, y llevan de un click al tab exacto
donde está el dato nuevo.

## 2. El problema que resuelve

v2 tiene un problema estructural: **el dato llega de forma asincrónica y el usuario
no tiene forma de enterarse**. Hoy la única manera de descubrir que algo cambió es
abrir el bookmark y recorrer los 7 tabs a mano, sin saber cuál tiene novedades.

| Evidencia | Dónde |
|---|---|
| 10 crons escriben datos de cuenta de forma asincrónica, algunos cada minuto | `vercel.json` |
| El research de una cuenta tarda 549s promedio, 795s p95 | auditoría §2.1 |
| La UI **ya poletea a mano**: `setInterval` cada 5s con timeout de 5 min | `app/bookmarks/[id]/_components/prospects-tab.tsx:291-344` |
| El detalle tiene 7 tabs y nada indica cuál tiene novedades | `app/bookmarks/[id]/page.tsx:462-501` |
| El cron marca contactos con `needs_review` y **no se renderiza en ninguna parte** | 0 ocurrencias en `app/**/*.tsx` |
| La auditoría ya lo pide: *"novedades no vistas"* | auditoría §11, días 31–60 |

El polling manual de `prospects-tab` es el síntoma más claro: se escribió un
mecanismo de espera ad-hoc dentro de un tab porque no existe un canal por donde
avisar que algo terminó.

## 3. Lo que ya está construido y no se usa

El sistema de digest se removió pero **las tablas quedaron** (script 102):

- `user_notification_preferences` — `digest_enabled`, `digest_frequency`, `last_digest_sent_at`
- `user_digest_sent_items` — ledger anti-duplicado de "ya te avisé"
- `digest_send_log` — auditoría de envíos

Y el deep-link ya funciona: `app/bookmarks/[id]/page.tsx:58` lee `?tab=`, así que
una card puede llevar al tab exacto sin tocar nada.

## 4. Decisiones tomadas

| Decisión | Elegido | Descartado |
|---|---|---|
| Granularidad del watermark | **Por cuenta** | Por tab (`seen_by_tab`) |
| Superficie | **Panel en la campanita** | Página `/notifications` |
| Email | **No, en fase 1** | Digest semanal |
| Feed de movimientos | **Absorbido acá** como un tipo de notificación | Feed `/movements` propio |

## 5. Arquitectura: híbrido watermark + eventos

> **Watermark** para datos de volumen. **Evento** para hechos puntuales y accionables.

| | Tabla de eventos (fan-out) | Watermark |
|---|---|---|
| Hay que tocar los productores | Sí, los 10 crons | **No, ninguno** |
| Crecimiento de filas | N usuarios × M eventos | Una fila por usuario × cuenta |
| Descartar de a uno | Sí | No |
| Granularidad | Una card por hecho | "3 noticias nuevas" |

El riesgo del fan-out no es teórico: `public.cron_executions` ya tiene ~1,3M de
filas por un log más simple.

- **Watermark** → noticias, implementaciones, radar, vacantes. Nadie quiere una card
  por vacante: quiere *"Cencosud · 4 vacantes nuevas"*.
- **Evento** → movimiento de contacto, research terminado, enrichment completo.
  Hechos únicos, accionables, que se descartan de a uno.

**La fase 1 es sólo watermark y no toca ningún cron.**

---

## 6. Especificación de construcción — Fase 1

### 6.1 Alcance de los productores

Se cuentan **cuatro**: noticias, implementaciones, radar y vacantes. Los tres
primeros salen de la vista `public.company_evidence` del contrato; las vacantes
se cuentan aparte porque no son evidencia narrativa.

**`signals` queda afuera**, y la razón es un número: **1.694.025 filas totales,
189.914 en los últimos 30 días**. Es un firehose del ETL —se generan al ingestar
contactos y vacantes, no cuando pasa algo en la cuenta— y produciría cards del tipo
*"Arcor · 4.812 señales nuevas"*. Además es la única tabla sin índice compuesto por
fecha. Si algún día entra, lo hace agregada por diccionario, no por fila.

Volumen real de los que sí entran (medido 2026-08-17):

| Tabla | Total | Últimos 30 días |
|---|---:|---:|
| `job_postings` | 41.224 | 7.767 |
| `company_news` | 1.133 | 49 |
| `company_implementations` | 727 | 77 |
| `radar_findings` | 706 | 310 |

Bookmarks por usuario: promedio 35, p90 108, **máximo 411**. Con esos volúmenes y
los índices de la fase A del contrato, no hace falta contador materializado.

### 6.2 Migración: `scripts/506_notification_watermarks.sql`

```sql
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

### 6.3 RPC de novedades

Lee la vista canónica, así que no repite la lógica de las tres tablas.

```sql
create or replace function public.get_account_updates(p_limit int default 100)
returns table (
  bookmark_id    uuid,
  company_id     uuid,
  company_name   text,
  priority       text,
  since          timestamptz,
  news_count     int,
  impl_count     int,
  radar_count    int,
  jobs_count     int,
  total_count    int,
  last_update_at timestamptz
)
language sql
stable
security definer          -- radar_findings sólo es legible por service_role
set search_path = public  -- evita search_path hijacking
as $$
  with mine as (
    select b.id as bookmark_id, b.company_id, b.priority,
           coalesce(w.last_seen_at, b.created_at) as since
    from public.bookmarks b
    left join public.user_account_watermarks w
      on w.bookmark_id = b.id and w.user_id = b.user_id
    where b.user_id = auth.uid()   -- nunca un parámetro: no se puede suplantar
  ),
  ev as (
    select m.bookmark_id,
           count(*) filter (where e.evidence_kind = 'news')           as news_count,
           count(*) filter (where e.evidence_kind = 'implementation') as impl_count,
           count(*) filter (where e.evidence_kind = 'radar')          as radar_count,
           max(e.detected_at)                                         as last_at
    from mine m
    join public.company_evidence e
      on e.company_id = m.company_id
     and e.detected_at > m.since
    group by m.bookmark_id
  ),
  jb as (
    select m.bookmark_id, count(*) as jobs_count, max(j.created_at) as last_at
    from mine m
    join public.job_postings j
      on j.company_id = m.company_id
     and j.created_at > m.since
    group by m.bookmark_id
  )
  select
    m.bookmark_id, m.company_id, co.name, m.priority, m.since,
    coalesce(ev.news_count, 0)::int,
    coalesce(ev.impl_count, 0)::int,
    coalesce(ev.radar_count, 0)::int,
    coalesce(jb.jobs_count, 0)::int,
    (coalesce(ev.news_count,0) + coalesce(ev.impl_count,0)
      + coalesce(ev.radar_count,0) + coalesce(jb.jobs_count,0))::int as total_count,
    greatest(coalesce(ev.last_at, m.since), coalesce(jb.last_at, m.since)) as last_update_at
  from mine m
  join public.companies co on co.id = m.company_id
  left join ev on ev.bookmark_id = m.bookmark_id
  left join jb on jb.bookmark_id = m.bookmark_id
  where coalesce(ev.news_count,0) + coalesce(ev.impl_count,0)
      + coalesce(ev.radar_count,0) + coalesce(jb.jobs_count,0) > 0
  order by
    case m.priority when 'alta' then 0 when 'transaccional' then 1 else 2 end,
    last_update_at desc
  limit p_limit;
$$;

revoke all on function public.get_account_updates(int) from public;
grant execute on function public.get_account_updates(int) to authenticated;
```

> **Nota de seguridad:** `auth.uid()` va *dentro* de la función, no como parámetro.
> Es más estricto que `get_prospects_for_icebreakers(p_bookmark_id, p_user_id)`
> (script 098), que confía en un `user_id` que manda el cliente.

### 6.4 RPC de marcado

```sql
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

### 6.5 La regla del watermark (lo más importante del diseño)

**Se lee primero, se actualiza después.** `mark_account_seen` devuelve el watermark
*anterior* justamente para eso:

1. El usuario abre `/bookmarks/{id}`.
2. La página llama `mark_account_seen(id)` → recibe `previousSeenAt` y ya deja el
   watermark en `now()`.
3. `previousSeenAt` baja por props a los tabs, que marcan como **"nuevo"** las filas
   posteriores a esa fecha.

Sin esto, abrir la cuenta borraría la novedad antes de que el usuario la vea, que es
el error clásico de esta feature.

**Trade-off aceptado del watermark por cuenta:** abrir la cuenta la marca vista
entera, incluidos los tabs que no se abrieron. Se compensa con el resaltado por
`previousSeenAt`, que sobrevive a la visita.

### 6.6 Archivos

**Nuevos**

| Archivo | Qué |
|---|---|
| `scripts/506_notification_watermarks.sql` | Tabla + las dos RPC + grants |
| `app/actions/notifications.ts` | `getAccountUpdates()`, `markAccountSeen()` |
| `components/notifications/notification-bell.tsx` | Campanita + badge + `Popover` |
| `components/notifications/notification-card.tsx` | Card de cuenta con deep-link |
| `hooks/use-account-updates.ts` | SWR con `refreshInterval: 60_000` |

**Modificados**

| Archivo | Cambio |
|---|---|
| `components/main-sidebar.tsx` | Montar `<NotificationBell />` en desktop y en la barra mobile |
| `app/bookmarks/[id]/page.tsx` | `markAccountSeen` al montar; pasar `previousSeenAt` a los tabs |
| `.../_components/{news,job-postings,intelligence}-tab.tsx` | Badge "nuevo" en filas posteriores a `previousSeenAt` |

### 6.7 Contratos

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
  radarCount: number
  jobsCount: number
  totalCount: number
  lastUpdateAt: string
}

export async function getAccountUpdates(limit?: number): Promise<AccountUpdate[]>
export async function markAccountSeen(bookmarkId: string): Promise<string> // previousSeenAt
```

**Deep-link por productor dominante** (el de mayor conteo define el tab):

| Productor | Destino |
|---|---|
| `newsCount` | `/bookmarks/{id}?tab=news` |
| `implCount` / `radarCount` | `/bookmarks/{id}?tab=intelligence` |
| `jobsCount` | `/bookmarks/{id}?tab=jobpostings` |

### 6.8 Copy

```
Cencosud                                    hace 2 h
3 noticias · 1 vacante                   [Ver novedades →]

Falabella                                   ayer
4 vacantes nuevas                        [Ver novedades →]
```

Vacío: *"Estás al día. Te avisamos cuando haya algo nuevo en tus cuentas guardadas."*

Badge de la campanita = **cantidad de cuentas con novedades**, no la suma de hechos.
Un badge en "47" por 47 vacantes de una sola cuenta es ansiedad, no información.

### 6.9 Casos borde

| Caso | Comportamiento |
|---|---|
| Bookmark nunca abierto | `since = bookmarks.created_at`: lo anterior a guardarlo no es novedad |
| Usuario con 411 bookmarks | `p_limit` + orden por `priority`; el panel muestra top 10 con "ver todas" |
| `created_at` nulo en news/impl | La comparación `> since` lo descarta. Son filas viejas previas al default |
| Bookmark borrado | `on delete cascade` limpia el watermark |
| Dato pedido por el propio usuario | **Cuenta igual**: pidió un research async y el aviso de que terminó es el valor |
| Dato traído por **otro** usuario | **Cuenta**: el cache es global por compañía. Es el valor del modelo colaborativo |
| Dos pestañas abiertas | El upsert es idempotente; gana el `now()` más reciente |

### 6.10 Plan de prueba

- **SQL**: `EXPLAIN ANALYZE` de `get_account_updates()` con el usuario de 411
  bookmarks. Objetivo **< 200 ms**. Atención especial al plan sobre la vista
  `company_evidence` (UNION ALL): verificar que empuja el filtro por `company_id` a
  cada rama.
- **Unit (vitest)**: derivación de la card — tab destino según productor dominante,
  copy y pluralización. Es lo único puro.
- **Manual**: bookmarkear, insertar una noticia posterior, ver la card, abrir la
  cuenta, verificar el resaltado y que la card desaparece al recargar.
- **RLS**: con dos usuarios, confirmar que `get_account_updates()` nunca devuelve
  bookmarks ajenos y que `mark_account_seen` de un bookmark ajeno tira excepción.

### 6.11 Definition of done

- [ ] Contrato de evidencia (fases A–B) aplicado
- [ ] `506` aplicado; `EXPLAIN ANALYZE` bajo 200 ms en el peor caso
- [ ] Campanita en desktop y mobile, badge por cantidad de cuentas
- [ ] Card lleva al tab correcto y marca la cuenta como vista
- [ ] Filas nuevas resaltadas con `previousSeenAt` en esa misma visita
- [ ] Estado vacío implementado
- [ ] Test de RLS con dos usuarios en verde
- [ ] `pnpm typecheck` y `pnpm test` en verde

**Estimación: 3–4 días** después del contrato. No toca ningún cron.

---

## 7. Fases siguientes

| # | Alcance | Esfuerzo |
|---|---|---|
| 2 | `user_notifications` (eventos) + research/enrichment terminado + retención en `cleanup` | 3 días |
| 3 | `contact_movement` conectado (ver `feature-movimientos-de-contactos-v2.md`) | 1 día |
| 4 | Email semanal reusando `user_notification_preferences` + `user_digest_sent_items` | 2–3 días |
| 5 | Realtime para actualizar la campanita sin refresh, y **borrar el polling de `prospects-tab`** | 2 días |

Modelo de la tabla de eventos para la fase 2:

```sql
create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  bookmark_id uuid references public.bookmarks(id) on delete cascade,
  company_id  uuid references public.companies(id) on delete cascade,
  kind text not null check (kind in (
    'contact_movement','research_completed','enrichment_completed',
    'account_refreshed','contact_needs_review'
  )),
  title text not null,
  body  text,
  deep_link text not null,
  payload jsonb,
  status text not null default 'unread' check (status in ('unread','read','dismissed')),
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  dedupe_key text not null,
  unique (user_id, dedupe_key)
);
```

**Retención desde el día uno** (la lección de `cron_executions`): el cron semanal
`/api/cron/cleanup` borra `dismissed` de más de 30 días y todo lo de más de 90.

---

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Costo de la RPC sobre la vista `UNION ALL` | Índices de la fase A del contrato. **Medir con `EXPLAIN ANALYZE` antes de optimizar** |
| Fatiga de notificaciones | Agrupación por cuenta + tope en el panel + preferencias por tipo (fase 2) |
| Crecimiento de `user_notifications` (fase 2) | Retención desde el día uno en `/api/cron/cleanup` |
| Ruido en usuarios con muchos bookmarks | Orden por `priority` del bookmark, que ya existe |

---

## 9. Anexo: relación entre las tablas de evidencia

Las tres tablas que alimentan esta feature **no son lo mismo pero se solapan**:

| Tabla | Unidad | Quién escribe |
|---|---|---|
| `company_news` | Un artículo (título, URL, medio, fecha) | v2 `/api/research/news` · v3 `external-drilldown` · MCP `submit_company_news` |
| `company_implementations` | Un proyecto (tecnología, proveedor, resultados) | v2 `/api/research/implementations` · v3 · MCP `submit_company_success_cases` |
| `radar_findings` | Un hallazgo tipado con `radar_type` + `category` | sólo v3: `radar.ts`, `jobs-interpreter.ts` |

`radar_findings.radar_type` admite `'news'` y tiene filas, así que **una noticia
puede terminar en dos tablas distintas según qué motor la trajo**. Ese solapamiento,
sus consecuencias y el plan para resolverlo están en
**`docs/plan-unificacion-evidencia-v2-v3.md`**, que es la dependencia de esta feature.

Dato útil para `feature-movimientos-de-contactos-v2.md`: `radar_findings` ya tiene
14 filas con `category = 'executive-change'`. El radar **ya detecta cambios de
ejecutivos**.
