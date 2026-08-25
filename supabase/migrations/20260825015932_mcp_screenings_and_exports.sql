-- ═══════════════════════════════════════════════════════════
-- Fase 3: export de verdad, sin pasar la tabla por la conversación.
--
-- POR QUE PERSISTIR EL SCREENING
--   El diseño original pedía `create_export(jobId)`. La pregunta de fondo es de
--   dónde salen las filas del archivo, y hay dos respuestas posibles:
--
--     a) que quien llama las reenvíe a la tool. Es lo simple, y NO sirve: las
--        filas ya viajaron una vez en la respuesta de screen_account_list, y
--        reenviarlas las hace viajar dos veces. El costo que el export viene a
--        eliminar —la conversación como canal de transporte de datos— se
--        duplica en vez de desaparecer.
--     b) que el screening quede guardado y el export se pida por un handle.
--
--   Es (b). Un lote de 61 cuentas pesa ~20k tokens; con (a) serían ~40k para
--   terminar con el mismo archivo. Con 139 cuentas ya no entra.
--
--   El efecto secundario es tan valioso como el principal: queda registro de QUÉ
--   se le reportó a un cliente y con qué parámetros. Hoy eso vive en el historial
--   de un chat y se pierde.
--
-- QUE NO ES
--   No es cupo ni cuota: guardar el resultado de una lectura no cuesta nada y no
--   ocupa lugares del plan. Las filas caducan solas (TTL) porque son un recorte
--   de un momento, no la fuente de verdad: esa sigue siendo el catálogo.
-- ═══════════════════════════════════════════════════════════

create table if not exists v3.mcp_screenings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references v3.workspaces(id) on delete cascade,
  user_id uuid not null,
  api_key_id uuid,
  oauth_token_id uuid,
  /** Con qué se pidió: términos, países, umbrales. Sin esto la tabla no es auditable. */
  params jsonb not null,
  /** Una fila por nombre de la lista del cliente, tal como se devolvió. */
  rows jsonb not null,
  summary jsonb not null,
  row_count integer not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists mcp_screenings_workspace_created_idx
  on v3.mcp_screenings (workspace_id, created_at desc);

alter table v3.mcp_screenings enable row level security;

comment on table v3.mcp_screenings is
  'Fase 3: resultado de screen_account_list guardado para poder exportarlo por handle, sin reenviar la tabla por la conversación. Caduca solo.';

-- ── Exportaciones generadas ─────────────────────────────────
create table if not exists v3.mcp_exports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references v3.workspaces(id) on delete cascade,
  user_id uuid not null,
  /** De dónde salieron las filas. */
  source_kind text not null,
  source_id uuid not null,
  format text not null,
  storage_path text not null,
  row_count integer not null,
  byte_size integer,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists mcp_exports_workspace_created_idx
  on v3.mcp_exports (workspace_id, created_at desc);

alter table v3.mcp_exports enable row level security;

comment on table v3.mcp_exports is
  'Fase 3: archivos generados por create_export. storage_path apunta al bucket workspace-exports; la URL se firma al momento y no se guarda.';

-- ── Bucket privado para los archivos ────────────────────────
--
-- Privado a propósito: el archivo lleva la lista de cuentas de un cliente y su
-- evidencia. Se entrega SIEMPRE con URL firmada y vencimiento, nunca por URL
-- pública. El límite de 25 MB cubre con holgura una planilla de 200 filas.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workspace-exports',
  'workspace-exports',
  false,
  26214400,
  array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv'
  ]
)
on conflict (id) do nothing;
