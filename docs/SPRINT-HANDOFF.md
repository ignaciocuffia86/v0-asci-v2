# Sprint handoff — ASCI (bookmark bug + Track A/C)

> Documento de traspaso para retomar en un chat nuevo sin depender del MCP de
> Supabase. Captura el estado del sprint y todas las **definiciones live** que ya
> se extrajeron de producción (`grenlquhexbyneubtdub` = asciv2-database, sa-east-1).
> Fecha: 2026-08-13.

## TL;DR
- **El bug del bookmark YA está arreglado y mergeado** (PR #94 y #95 en `main`). No hay que rehacerlo.
- Rama de trabajo: `claude/architecture-review-recommendations-f4k898`.
- Pendiente del sprint: **A2** (country_normalized — decisión de diseño abierta) y **A3** (source-tagging). Más follow-ups menores de A1.

---

## 1. Bug del bookmark (correos/teléfonos) — RESUELTO

**Síntoma:** en el bookmark no se veían todos los emails (faltaba el corporativo) ni teléfonos, ni en la UI ni en el export Excel.

**Diagnóstico (verificado en vivo):**
- La data y el RPC están **sanos**. No es problema de contenido.
- Ejecutado sobre un bookmark real, `get_bookmark_export_data` devuelve teléfonos y el email corporativo. Patrón típico: `email1` = personal (gmail/hotmail), `email2` = corporativo (`@empresa.com`), `phone1` = número real.
- **Causa 1 (UI):** `getBookmarkSmartContext` colapsaba a `email1 || email2` → ocultaba el corporativo cuando estaba en `email2/3/4`. Y solo mostraba `email1`/`phone1`.
- **Causa 2 (Excel):** el RPC desplegado exponía `email1/2 + phone1/2` pero **NO** `email3/email4`.
- **Alumni (ex-empleados):** su contacto NO se muestra en UI (gate `!isAlumni`) y NO entra al Excel (el RPC filtra `is_current_employee = true`). **Decisión del usuario: dejar como está.**

**Fix aplicado (mergeado):**
- UI: `app/actions/workspace.ts` (`getBookmarkSmartContext`) ahora trae `email1..email4` + `phone1/2` (con type/status) y devuelve `emails[]`/`phones[]` deduplicados; `app/bookmarks/[id]/_components/overview-tab.tsx` renderiza todos.
- Excel: migración `supabase/migrations/20260813000000_bookmark_export_all_emails.sql` (`CREATE OR REPLACE get_bookmark_export_data`) agrega `email3/email4` (+ mantiene `phone1/2`); `lib/export-bookmarks.ts` suma columnas Email 3 / Email 4.
- Validado: `tsc 0`, `eslint 0`, Supabase Preview (migración) verde. **Aplicado a prod al mergear #95.**

---

## 2. Definiciones LIVE extraídas de prod (para no depender del MCP)

### 2.1 `get_bookmark_export_data(p_bookmark_id uuid, p_user_id uuid)`
- Desplegado en prod exponía en `employees_with_signals`: `email1, email2, phone1, phone2` (+ type/status). **Faltaba `email3/email4`** → lo agrega la migración `20260813000000`.
- Es `SECURITY DEFINER`, owner postgres. Cuerpo completo (fiel) en `supabase/migrations/20250101000000_baseline.sql:2758`.

### 2.2 `get_company_signal_summary(p_company_id uuid)` — A1
- **SECURITY INVOKER** (no DEFINER), owner postgres.
- EXECUTE concedido a: `anon`, `authenticated`, `service_role`.
- Lee `signals`, `job_postings`, diccionarios — filtrando **solo por `company_id`**. Definición en `baseline.sql:3310`.

### 2.3 RLS (verificado en vivo)
| Tabla | RLS | Políticas |
|---|---|---|
| `signals` | ON | SELECT: `auth.role() = 'authenticated'` (ven TODO, global). ALL: `is_superadmin()`. |
| `contacts` | ON | SELECT: `auth.role() = 'authenticated'`. ALL: `is_superadmin()`. |
| `job_postings` | ON | **SIN políticas** → `authenticated`/`anon` reciben **0 filas** (solo service_role via bypass). |

- `signals` columnas: `id, contact_id, signal_type, signal_id, keyword_matched, source_field, company_id, snippet, created_at, is_current_employee, job_posting_id, source_url, job_posted_at`. **Sin columna de tenant/workspace.**
- `job_postings` columnas: `id, company_id, title, description, location, salary_range, posted_at, is_active, source_data, created_at, updated_at, job_url, apply_url`. **Sin tenant.**
- `contacts` tiene `email1..email4` (+type/status), `phone1/phone2` (+type/status). **Sin workspace_id.** Tablas por-tenant separadas: `user_company_contacts`, `user_company_signals` (con `user_id`/`bookmark_id`).

### 2.4 `companies.country_normalized` — A2 (verificado en vivo)
Distribución (530k empresas):
- `NULL`: **473.095**
- Nombre completo en inglés (>3 chars, "Afghanistan"…"Vietnam"): **57.772**
- Códigos ISO (2-3 chars): **0** · vacíos: **0**

→ Hoy el invariante "nombre, no ISO" **se cumple**. No hay data para limpiar.

---

## 3. A1 — veredicto: NO es leak cross-tenant (falso positivo del informe)
`get_company_signal_summary` lee un **pool global de v2 por diseño** (signals/contacts: SELECT para cualquier authenticated, escritura solo superadmin; sin columna de tenant). Es la inteligencia compartida que v3 debe leer. **No hay data por-tenant que filtrar.**

Hallazgos colaterales reales:
1. **`job_postings` RLS ON sin políticas** → un caller `authenticated` recibe 0 job_postings; `get_company_signal_summary` en contexto de usuario da `job_postings_count = 0`. Bug latente (decidir: agregar SELECT policy tipo signals/contacts, o forzar service_role).
2. **`get_company_signal_summary` ejecutable por `anon`** → inofensivo (RLS de signals/contacts exige authenticated), pero es higiene: se puede `REVOKE EXECUTE ... FROM anon`.
3. **Ingest sin gate superadmin** → **YA ARREGLADO** en commit `1b35c77` (branch): `requireSuperadmin()` en `app/api/ingest/upload/route.ts` y `blob-upload/route.ts`.

---

## 4. A2 — DECISIÓN ABIERTA (lo que falta resolver)
Conflicto de write-paths sobre `country_normalized`:
- **Trigger** canónico: `NEW.country_normalized := normalize_country(NEW.country)` → escribe **nombres** (baseline:4478, 6577).
- **Ruta `app/api/v3/admin/normalize-country-phase5/route.ts:85`**: `.update({ country_normalized: mapping.iso })` → escribe **ISO**. NO está en `vercel.json` (manual-only, Bearer CRON_SECRET), pero `normalizeCountries()` **sí funciona** → footgun dormido que rompería exports si se corre.

**Decisión requerida del usuario:** ¿el invariante es **nombres** (lo que hoy hay y de lo que dependen los exports) o **ISO** (lo que intentaba phase5)?
- Recomendado: **nombres**. Entonces: (a) arreglar phase5 para que escriba el nombre normalizado (no ISO) o deshabilitar la ruta; (b) migración con `CHECK (country_normalized IS NULL OR char_length(trim(country_normalized)) >= 4)` — seguro porque 0 filas lo violan hoy; hace que un ISO futuro falle fuerte en vez de romper en silencio.

## 5. A3 — pendiente (no arrancado)
Marcar `source: v2|v3` en `radar_findings` y `job_postings` (OPT-16) vía migración, para auditar/revertir por producto; guarda para UPDATE masivos sobre `companies`.

---

## 6. Estado de PRs / ramas
- **PR #91, #92, #93, #94, #95: MERGEADOS** a `main` (informe+baseline, P0 seguridad, CI gate, drop ignoreBuildErrors, bookmark+Track C).
- Branch actual `claude/architecture-review-recommendations-f4k898` tiene el commit `1b35c77` (gate ingest A1) **sin PR todavía**.
- Branch protection en `main`: requiere `Unit tests`, `Typecheck`, `Lint`.

## 7. Cómo retomar en un chat nuevo
1. Rama: `claude/architecture-review-recommendations-f4k898` (o reiniciar desde `main` si #95 ya está en main y esta rama solo tiene el commit del ingest).
2. Prender el connector **Supabase** en el chat (proyecto `grenlquhexbyneubtdub`) para A2/A3 en vivo; si no, este doc tiene las definiciones necesarias.
3. Próximos pasos: cerrar **A2** (tras decidir nombres vs ISO), hacer **A3**, y los follow-ups de A1 (#1 RLS job_postings, #2 revoke anon). Abrir PR con el commit del ingest ya hecho.
