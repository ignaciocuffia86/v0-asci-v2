# Feature: Movimientos de contactos (v2)

Fecha: 2026-08-17
Zona: **v2** (schema `public`, rutas `/bookmarks` y `/movements`, deploy `v0-asci-v2`)
Antecedente: `docs/deteccion-cambios-de-puesto.md`

---

## 1. Qué es

Detectar y accionar cuándo una persona **cambia de empresa** o **cambia de puesto**,
y convertir ese hecho en una señal comercial dentro de v2.

Tres lecturas, que son el producto:

| Situación | Lectura comercial |
|---|---|
| Tu contacto se fue a otra empresa | **Entrada caliente** en la cuenta destino |
| Tu contacto en una cuenta bookmarkeada se fue | **Gap**: hay que remapear la cuenta |
| Llegó alguien nuevo a un cargo relevante | **Ventana de 90 días**: los ejecutivos nuevos compran |

## 2. Por qué es de v2 y no de v3

No es una decisión de gusto, es dónde vive el dato:

- El detector ya existe y es **código de v2**: `app/api/cron/apollo-reverify/route.ts`
  opera sobre `public.user_company_contacts` y `public.apollo_contacts_cache`.
- La unidad de cuenta en v2 es `public.bookmarks` (por usuario), y los contactos
  cuelgan de ahí (`user_company_contacts.bookmark_id`, script 042).
- El hecho "una persona se movió" es **cache global** en `public`, que es
  justamente lo que v2 posee y v3 consume. Construirlo en v2 lo deja disponible
  para v3 vía `svc_v3_cache_reader` sin romper el invariante ("v3 lee `public`,
  no lo escribe").

## 3. El punto de partida: lo que ya se calcula y nadie ve

El cron de re-verify corre a diario a las 04:00 y ya detecta el cambio de empresa:

```ts
// app/api/cron/apollo-reverify/route.ts
const movedCompany =
  cacheEntry?.organization_id &&
  person.organizationId &&
  cacheEntry.organization_id !== person.organizationId
const reviewReason = movedCompany ? "changed_company" : null
```

Dos problemas, ambos baratos de arreglar:

1. **El evento se pisa.** El `update` escribe `role: person.title ?? c.role`, así que
   el título anterior desaparece. El cambio de puesto *dentro* de la misma empresa
   —la promoción— no se detecta ni se registra.
2. **Nadie lo ve.** `needs_review` y `review_reason` **no se renderizan en ninguna
   parte de la UI** (verificado: cero ocurrencias en `app/**/*.tsx` y
   `components/**/*.tsx`). El cron viene marcando contactos para una bandeja que no existe.

---

## 4. Modelo de datos

Dos capas, siguiendo el patrón que ya usa la plataforma (hecho global compartido +
interpretación privada por usuario).

### 4.1 `public.contact_movements` — el hecho

Global, sin `user_id`. Escrito **sólo por service_role**. Es a las personas lo que
`radar_findings` es a la tecnología.

```sql
CREATE TABLE IF NOT EXISTS public.contact_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identidad de la persona (mínima necesaria: sin email ni teléfono)
  person_name        text NOT NULL,
  linkedin_url       text,              -- identificador estable cross-source
  apollo_person_id   text,

  movement_type text NOT NULL CHECK (movement_type IN (
    'company_change',    -- cambió de empresa
    'title_change',      -- cambió de puesto en la misma empresa
    'new_appointment',   -- nombramiento detectado en prensa (puede no tener contacto previo)
    'role_opening'       -- proxy: se abrió la vacante de ese rol
  )),

  from_company_id uuid REFERENCES public.companies(id),
  to_company_id   uuid REFERENCES public.companies(id),
  from_title      text,
  to_title        text,
  seniority       text,
  is_decision_maker boolean DEFAULT false,

  -- Procedencia y calidad
  detector        text NOT NULL CHECK (detector IN ('apollo_reverify','news','job_posting_proxy')),
  evidence_level  text NOT NULL DEFAULT 'inferred' CHECK (evidence_level IN ('explicit','inferred')),
  confidence      numeric(3,2) CHECK (confidence BETWEEN 0 AND 1),
  source_url      text,
  source_name     text,
  source_date     date,
  supporting_job_posting_ids uuid[] DEFAULT '{}',

  occurred_at  timestamptz,   -- cuándo pasó (si se sabe)
  detected_at  timestamptz NOT NULL DEFAULT now(),
  dedupe_hash  text NOT NULL,
  UNIQUE (dedupe_hash)
);

CREATE INDEX IF NOT EXISTS idx_contact_movements_from
  ON public.contact_movements (from_company_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_movements_to
  ON public.contact_movements (to_company_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_movements_linkedin
  ON public.contact_movements (linkedin_url) WHERE linkedin_url IS NOT NULL;

ALTER TABLE public.contact_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read for authenticated" ON public.contact_movements
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "write only service role" ON public.contact_movements
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
```

**Minimización de PII deliberada:** el hecho global guarda nombre, LinkedIn, empresa
y cargo — lo necesario para identificar el movimiento. Email y teléfono **no suben**
a la capa global: siguen viviendo en `user_company_contacts` del usuario que los
enriqueció y los pagó.

`dedupe_hash` = hash de `(linkedin_url | apollo_person_id | lower(person_name)) +
movement_type + to_company_id + coalesce(to_title,'') + date_trunc('month', occurred_at)`.
Evita que las tres fuentes carguen el mismo movimiento tres veces.

### 4.2 `public.user_contact_movements` — la bandeja del usuario

```sql
CREATE TABLE IF NOT EXISTS public.user_contact_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  movement_id uuid NOT NULL REFERENCES public.contact_movements(id) ON DELETE CASCADE,

  -- Anclaje al mundo de v2
  bookmark_id uuid REFERENCES public.bookmarks(id) ON DELETE CASCADE,
  contact_id  uuid REFERENCES public.user_company_contacts(id) ON DELETE SET NULL,

  relevance text NOT NULL CHECK (relevance IN (
    'champion_moved',   -- mi contacto se fue → entrada caliente en la cuenta destino
    'account_gap',      -- perdí un contacto en una cuenta que sigo
    'new_decision_maker'-- llegó alguien nuevo a un cargo relevante
  )),

  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','seen','actioned','dismissed')),
  dismiss_reason text,          -- alimenta la calibración de falsos positivos

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, movement_id, relevance)
);

CREATE INDEX IF NOT EXISTS idx_ucm_user_status
  ON public.user_contact_movements (user_id, status, created_at DESC);

ALTER TABLE public.user_contact_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rows" ON public.user_contact_movements
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

> La policy lleva `WITH CHECK` explícito: es exactamente el hallazgo P0.4 de la
> auditoría (policies `ALL` sin `WITH CHECK`). No repitamos el patrón viejo.

Archivo propuesto: **`scripts/502_contact_movements.sql`** (el último es `501`).

---

## 5. Cómo se detecta: tres fuentes, un solo destino

```
apollo-reverify (cron 04:00)  ─┐
extractor de noticias          ─┼──►  contact_movements  ──►  fan-out  ──►  user_contact_movements
proxy de vacantes             ─┘        (hecho global)                        (bandeja por usuario)
```

### 5.1 Apollo re-verify — el cambio mínimo

En `app/api/cron/apollo-reverify/route.ts`, **antes** del `update` que hoy pisa el
título, emitir el evento:

```ts
const movedCompany = cacheEntry?.organization_id && person.organizationId
  && cacheEntry.organization_id !== person.organizationId
const changedTitle = !movedCompany && c.role && person.title && c.role !== person.title

if (movedCompany || changedTitle) {
  await recordMovement({
    personName: c.full_name,
    linkedinUrl: c.linkedin_url,
    apolloPersonId: c.apollo_person_id,
    movementType: movedCompany ? "company_change" : "title_change",
    fromCompanyId: c.company_id,
    toCompanyId: await resolveCompanyByDomain(person.organizationDomain), // puede ser null
    fromTitle: c.role,
    toTitle: person.title,
    detector: "apollo_reverify",
    evidenceLevel: "explicit",
    confidence: movedCompany ? 0.8 : 0.6,
  })
}
```

`resolveCompanyByDomain` matchea la empresa destino contra `public.companies`. Si
resuelve, se habilita el *champion_moved*: **la entrada caliente**. Si no resuelve,
el movimiento igual se registra (el gap en la cuenta origen vale por sí solo).

Además: **dejar de pisar el título en silencio.** El `update` sigue igual, pero el
cambio ya quedó registrado como evento.

### 5.2 Cobertura: el límite real a resolver

Hoy el cron procesa `batchSize = 50` por día sobre candidatos con
`last_verified_at > 90 días` (vista `apollo_reverify_candidates`, script 107). Eso
da un ciclo de `N/50` días: con 4.500 contactos el ciclo cierra justo en 90 días,
con más se rompe y hay contactos que nunca se re-verifican.

Propuesta: **priorizar en la vista** en lugar de subir el batch a ciegas —
`is_decision_maker = true` primero, después contactos de bookmarks con
`priority = 'alta'`, después el resto. Cada match consume crédito de Apollo, así que
el batch se dimensiona con dato: `logApolloCall` ya instrumenta el costo.

### 5.3 Noticias (`new_appointment`)

Los nombramientos de C-level se publican en prensa, y en LATAM más que en LinkedIn.
Se corre el motor de research existente y se extrae estructurado:
`{persona, cargo_nuevo, cargo_anterior, empresa, fecha, fuente}` → `movement_type
= 'new_appointment'`, `evidence_level = 'explicit'`, `source_url` obligatorio.

**Ojo con un detalle de v2:** `public.company_news` tiene `user_id` y `bookmark_id`
`NOT NULL` (script 079) — o sea, la noticia está atada al usuario que la pidió. El
extractor **no puede** depender de esa tabla como fuente global: escribe el hecho
directamente en `contact_movements`, que sí es global, y usa `company_news` sólo
como uno de los insumos de texto.

Acá no hay identificador de persona, así que el matching contra un contacto conocido
es difuso (nombre + empresa). Criterio: si no matchea, **el movimiento se guarda
igual** con `contact_id = null` — "Cencosud nombró un CTO nuevo" es útil aunque no
tengas a esa persona en tu lista.

### 5.4 Vacantes (`role_opening`) — el más barato y el único anticipatorio

Ya está el dato en `public.job_postings`. Una vacante de un cargo de decisión
significa que el rol está vacante o es nuevo, y aparece **antes** de que nadie
actualice su perfil. `confidence` bajo (0.3–0.4), `evidence_level = 'inferred'`, y
`supporting_job_posting_ids` para que el usuario vea la vacante que lo disparó.

---

## 6. Fan-out: del hecho a la bandeja

Una función `fanOutMovement(movementId)` que corre después de cada inserción:

| Regla | Genera |
|---|---|
| Existe `user_company_contacts` de ese usuario con ese `apollo_person_id`/`linkedin_url`, y `to_company_id` resolvió | `champion_moved` |
| El usuario tiene bookmark de `from_company_id` | `account_gap` (prioridad alta si el contacto era `is_decision_maker`) |
| El usuario tiene bookmark de `to_company_id` y el cargo es de decisión | `new_decision_maker` |

Un mismo movimiento puede generar dos filas para el mismo usuario (perdió un
contacto **y** ganó una entrada en otra cuenta que ya sigue). Por eso el `UNIQUE`
incluye `relevance`.

---

## 7. UI en v2

Todo sobre patrones que ya existen, sin componentes nuevos de base.

### 7.1 Tab "Movimientos" en el detalle de bookmark

`app/bookmarks/[id]/page.tsx` ya tiene 7 tabs con el patrón
`TabsTrigger` + `TabsContent` + `_components/*-tab.tsx`. Se agrega
`_components/movements-tab.tsx` con la misma forma que `job-postings-tab.tsx`.

Muestra la línea de tiempo de la cuenta: quién entró, quién salió, quién cambió de
cargo, con fuente y fecha. Acciones por fila: *ver la cuenta destino*, *buscar
reemplazo* (dispara el flujo de prospects que ya existe), *descartar*.

### 7.2 Badge en el tab de Prospectos

`prospects-tab.tsx` hoy ignora `needs_review`. Con un badge "cambió de empresa" /
"cambió de cargo" en la tarjeta del contacto, se paga la deuda de que el cron viene
marcando contactos que nadie mira. **Es el cambio de menor esfuerzo y mayor efecto
inmediato.**

### 7.3 Feed global `/movements`

Ruta nueva en el sidebar (`components/main-sidebar.tsx`, entre *Bookmarks* y
*Documentos*), con `AppShell` y layout con guard de auth como el resto de v2. Es la
bandeja de entrada: movimientos `new` de todas las cuentas del usuario, agrupados
por relevancia, con contador en el ítem del sidebar.

Acá está el valor real de la feature: es lo que el vendedor abre el lunes a la
mañana.

> Nota de implementación: seguir el patrón de v2 (client component + fetch con el
> cliente browser de Supabase) para no mezclar estilos, **o** aprovechar y hacerla
> server component con `<Suspense>` — es una página nueva, no arrastra deuda. Ver
> `docs/plan-instant-navigations.md` §9.6.

### 7.4 Digest semanal por email

`docs/digest.md` tiene la spec de la feature de email que se removió, y
`app/actions/resend.ts` ya tiene la integración. Un digest semanal de movimientos
—"3 movimientos en tus cuentas esta semana"— es el mejor gancho de reactivación
que se puede construir sobre esto, y reusa infraestructura existente.

---

## 8. Fases

| # | Alcance | Archivos | Esfuerzo |
|---|---|---|---|
| **1** | Tablas + emitir eventos desde el cron + badge en prospects + tab en bookmark | `scripts/502_*.sql`, `app/api/cron/apollo-reverify/route.ts`, `lib/movements/*`, 2 componentes | **2–3 días** |
| **2** | Fan-out completo, feed `/movements`, estados y descarte | ruta nueva + sidebar | 3–4 días |
| **3** | Extractor `new_appointment` sobre noticias con el motor de research | `lib/movements/news-extractor.ts` | ~1 semana |
| **4** | Digest semanal por email | reusa `app/actions/resend.ts` + `docs/digest.md` | 2–3 días |
| **5** | Proxy de vacantes + evaluar Apollo job change alerts nativo | — | 3–4 días |

La fase 1 sola ya entrega valor visible: el cron deja de marcar al vacío.

---

## 9. Riesgos y decisiones abiertas

| Riesgo | Mitigación |
|---|---|
| **Falsos positivos de Apollo.** El `organization_id` puede cambiar por merge o rebranding del lado de Apollo, sin que la persona se haya movido. | `confidence` + `dismiss_reason`. A las 4–6 semanas, revisar los descartes y calibrar. No inflar `confidence` sin dato. |
| **Costo de créditos Apollo** al subir cobertura. | Priorizar por DM y `priority='alta'` en vez de subir el batch. Medir con `logApolloCall` antes de escalar. |
| **PII.** Movimientos laborales de personas identificadas, en tabla compartida entre usuarios. | Minimización (sin email/teléfono en la capa global), acceso sólo a autenticados, escritura sólo service_role. Revisar retención antes de fase 3. |
| **Matching difuso en noticias.** | `contact_id = null` es un resultado válido, no un error. Nunca inventar la asociación. |
| **`company_news` es per-usuario.** | El extractor escribe el hecho en la capa global; `company_news` es insumo, no fuente de verdad. |

### Decisiones que quiero confirmar antes de codear

1. **`/movements` como página nueva vs. sección dentro de `/bookmarks`.** Propongo
   página nueva: es una bandeja transversal a todas las cuentas, no el detalle de una.
2. **Alcance de fase 1: ¿sólo `company_change` o también `title_change`?** Propongo
   ambos — el detector de título es 3 líneas y la promoción es señal de compra.
3. **¿El feed muestra movimientos de cuentas *no* bookmarkeadas?** Propongo que no
   en fase 1 (ruido), y evaluarlo en fase 3 cuando entren los nombramientos de prensa.
