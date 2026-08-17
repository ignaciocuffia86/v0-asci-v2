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

### Decisiones que quiero confirmar

1. **¿Watermark por cuenta o por tab?** Propongo empezar por cuenta (simple) y usar
   `seen_by_tab` sólo para el puntito de los tabs.
2. **¿Panel en la campanita o página `/notifications`?** Propongo panel; página sólo
   si el historial se vuelve necesario.
3. **¿El email semanal entra en el alcance inicial?** Propongo que no: primero medir
   si la gente usa el panel. El email sin uso previo es la vía rápida a que lo marquen
   como spam.
