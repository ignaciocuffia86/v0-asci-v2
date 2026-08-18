#!/usr/bin/env bash
# =============================================================================
# Valida una migración SQL contra una réplica local del esquema de producción,
# sin tocar Supabase y sin costo.
#
# Por qué existe: el proyecto aplica DDL directo sobre la base de producción de
# v2 (OPT-14 de la auditoría). Una branch de Supabase cuesta plata y no trae los
# datos; esto levanta un Postgres efímero, le aplica el baseline
# (supabase/migrations/20250101000000_baseline.sql, que es un dump real del
# esquema) y encima la migración que se quiera probar.
#
# Uso:
#   scripts/validate-migration-local.sh supabase/migrations/20260818045619_evidence_contract.sql
#
# Requisitos: postgresql-16 instalado (initdb, pg_ctl, psql).
# =============================================================================
set -euo pipefail

MIGRATION="${1:?Uso: $0 <ruta-al-sql>}"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${PGPORT_LOCAL:-55432}"
PGUSER_RUN="${PGUSER_RUN:-pgtest}"
PGDATA="/home/${PGUSER_RUN}/pgdata-validate"
DB=asci_validate
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

log() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# Postgres se niega a correr como root, así que se usa un usuario dedicado.
if [ "$(id -un)" = "root" ]; then
  id "$PGUSER_RUN" >/dev/null 2>&1 || useradd -m "$PGUSER_RUN"
  RUN_AS="su $PGUSER_RUN -c"
else
  RUN_AS="bash -c"
fi

log "1/5 Levantando Postgres efímero en :$PORT"
$RUN_AS "$PGBIN/pg_ctl -D $PGDATA stop" >/dev/null 2>&1 || true
rm -rf "$PGDATA"
$RUN_AS "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust" >/dev/null
$RUN_AS "$PGBIN/pg_ctl -D $PGDATA -o '-k /tmp -p $PORT -c listen_addresses=' -l /tmp/pg-validate.log start" >/dev/null
sleep 2
PSQL="psql -h /tmp -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -c "create database $DB;" >/dev/null

log "2/5 Sembrando lo que Supabase da por hecho (roles, schema auth)"
psql -h /tmp -p "$PORT" -U postgres -d "$DB" -q <<'SQL'
do $$ begin create role anon nologin;                exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin;       exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin;        exception when duplicate_object then null; end $$;
do $$ begin create role supabase_auth_admin nologin; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create schema if not exists extensions;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid()  returns uuid  language sql stable as $f$ select current_setting('request.jwt.claim.sub', true)::uuid $f$;
create or replace function auth.role() returns text  language sql stable as $f$ select coalesce(current_setting('request.jwt.claim.role', true), 'authenticated') $f$;
create or replace function auth.jwt()  returns jsonb language sql stable as $f$ select coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb $f$;
SQL

log "3/5 Aplicando el baseline del esquema de producción"
# El baseline no es 100% idempotente en su sección de constraints, así que los
# errores por objetos ya existentes no cortan la corrida: lo que importa es que
# las tablas queden creadas.
psql -h /tmp -p "$PORT" -U postgres -d "$DB" -q \
  -f "$REPO_ROOT/supabase/migrations/20250101000000_baseline.sql" 2>&1 | grep -i "^ERROR" || true
TABLAS=$(psql -h /tmp -p "$PORT" -U postgres -d "$DB" -t -A -c \
  "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';")
echo "   tablas en public: $TABLAS (producción tenía 54 al 2026-08-17)"

log "4/5 Aplicando $MIGRATION"
psql -h /tmp -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -f "$MIGRATION"

log "5/5 Reaplicando para verificar idempotencia"
psql -h /tmp -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f "$MIGRATION" >/dev/null
echo "   OK: la migración es reaplicable"

log "Listo. La base queda viva para inspeccionar:"
echo "   psql -h /tmp -p $PORT -U postgres -d $DB"
echo "   $RUN_AS \"$PGBIN/pg_ctl -D $PGDATA stop\"   # para apagarla"
