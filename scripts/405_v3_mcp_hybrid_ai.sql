begin;

alter table v3.mcp_api_keys
  add column if not exists owner_user_id uuid references auth.users(id),
  add column if not exists allowed_modes text[] not null default array['read']::text[];

update v3.mcp_api_keys set owner_user_id = created_by where owner_user_id is null;
alter table v3.mcp_api_keys alter column owner_user_id set not null;

alter table v3.mcp_request_logs
  add column if not exists workspace_id uuid,
  add column if not exists user_id uuid,
  add column if not exists tool_name text,
  add column if not exists mode text not null default 'read',
  add column if not exists request_id uuid,
  add column if not exists idempotency_key text,
  add column if not exists units integer not null default 0,
  add column if not exists error_code text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table v3.ai_usage_log
  add column if not exists api_key_id uuid references v3.mcp_api_keys(id),
  add column if not exists request_id uuid,
  add column if not exists research_job_id uuid references v3.research_jobs(id),
  add column if not exists generation_mode text not null default 'server_managed';

create table if not exists v3.mcp_usage_reservations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  user_id uuid not null references auth.users(id),
  api_key_id uuid not null references v3.mcp_api_keys(id),
  request_id uuid not null,
  idempotency_key text not null,
  pool text not null check (pool in ('research_server','icebreaker_server','research_client','icebreaker_client')),
  units integer not null check (units > 0),
  status text not null default 'reserved' check (status in ('reserved','committed','released')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  released_at timestamptz,
  unique (api_key_id, pool, idempotency_key)
);

create table if not exists v3.client_ai_executions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  user_id uuid not null references auth.users(id),
  api_key_id uuid not null references v3.mcp_api_keys(id),
  reservation_id uuid not null references v3.mcp_usage_reservations(id),
  feature text not null check (feature in ('account_research','icebreaker')),
  company_id uuid not null,
  contact_id text,
  current_stage text not null,
  status text not null default 'prepared' check (status in ('prepared','in_progress','completed','rejected','expired')),
  prompt_version text not null,
  package_hash text not null,
  package_payload jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists v3.client_ai_stage_submissions (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null references v3.client_ai_executions(id) on delete cascade,
  workspace_id uuid not null,
  stage text not null,
  package_hash text not null,
  idempotency_key text not null,
  result jsonb not null,
  validation_report jsonb not null default '{}'::jsonb,
  client_model text,
  status text not null check (status in ('accepted','rejected')),
  created_at timestamptz not null default now(),
  unique (execution_id, stage, idempotency_key)
);

alter table v3.account_briefs
  add column if not exists generation_mode text not null default 'server_managed',
  add column if not exists client_execution_id uuid references v3.client_ai_executions(id);
alter table v3.account_scorecards
  add column if not exists generation_mode text not null default 'server_managed',
  add column if not exists client_execution_id uuid references v3.client_ai_executions(id),
  add column if not exists prompt_version text;
alter table v3.icebreakers
  add column if not exists generation_mode text not null default 'server_managed',
  add column if not exists client_execution_id uuid references v3.client_ai_executions(id),
  add column if not exists prompt_version text,
  add column if not exists model text;

create index if not exists idx_mcp_reservations_user_pool_time on v3.mcp_usage_reservations(user_id,pool,created_at desc) where status <> 'released';
create index if not exists idx_mcp_reservations_workspace_pool_time on v3.mcp_usage_reservations(workspace_id,pool,created_at desc) where status <> 'released';
create index if not exists idx_client_ai_executions_workspace on v3.client_ai_executions(workspace_id,created_at desc);
create index if not exists idx_client_ai_submissions_execution on v3.client_ai_stage_submissions(execution_id,created_at);

alter table v3.mcp_usage_reservations enable row level security;
alter table v3.client_ai_executions enable row level security;
alter table v3.client_ai_stage_submissions enable row level security;

create or replace function v3.reserve_mcp_usage(
  p_workspace_id uuid, p_user_id uuid, p_api_key_id uuid, p_request_id uuid,
  p_idempotency_key text, p_pool text, p_units integer, p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = v3, public as $$
declare
  v_existing v3.mcp_usage_reservations;
  v_user_minute int; v_user_day int; v_user_week int;
  v_workspace_minute int; v_workspace_day int; v_workspace_week int;
  v_ulm int; v_uld int; v_ulw int; v_wlm int; v_wld int; v_wlw int;
begin
  if p_units < 1 then raise exception 'INVALID_UNITS'; end if;
  if not exists (select 1 from v3.mcp_api_keys k join v3.workspace_members wm on wm.workspace_id=k.workspace_id and wm.user_id=k.owner_user_id and wm.status='active' where k.id=p_api_key_id and k.workspace_id=p_workspace_id and k.owner_user_id=p_user_id and k.revoked_at is null) then raise exception 'INVALID_MCP_PRINCIPAL'; end if;
  select * into v_existing from v3.mcp_usage_reservations where api_key_id=p_api_key_id and pool=p_pool and idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('allowed',true,'reservationId',v_existing.id,'idempotent',true); end if;
  if p_pool='research_server' then v_ulm:=2; v_uld:=10; v_ulw:=30; v_wlm:=3; v_wld:=20; v_wlw:=60;
  elsif p_pool='icebreaker_server' then v_ulm:=5; v_uld:=30; v_ulw:=100; v_wlm:=10; v_wld:=100; v_wlw:=300;
  elsif p_pool='research_client' then v_ulm:=5; v_uld:=25; v_ulw:=75; v_wlm:=10; v_wld:=75; v_wlw:=225;
  else v_ulm:=10; v_uld:=50; v_ulw:=150; v_wlm:=20; v_wld:=150; v_wlw:=450; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_pool,0));
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':'||p_pool,0));
  select coalesce(sum(units) filter(where created_at>=now()-interval '1 minute'),0), coalesce(sum(units) filter(where created_at>=date_trunc('day',now())),0), coalesce(sum(units) filter(where created_at>=date_trunc('week',now())),0) into v_user_minute,v_user_day,v_user_week from v3.mcp_usage_reservations where user_id=p_user_id and pool=p_pool and status<>'released';
  select coalesce(sum(units) filter(where created_at>=now()-interval '1 minute'),0), coalesce(sum(units) filter(where created_at>=date_trunc('day',now())),0), coalesce(sum(units) filter(where created_at>=date_trunc('week',now())),0) into v_workspace_minute,v_workspace_day,v_workspace_week from v3.mcp_usage_reservations where workspace_id=p_workspace_id and pool=p_pool and status<>'released';
  if v_user_minute+p_units>v_ulm or v_user_day+p_units>v_uld or v_user_week+p_units>v_ulw or v_workspace_minute+p_units>v_wlm or v_workspace_day+p_units>v_wld or v_workspace_week+p_units>v_wlw then
    return jsonb_build_object('allowed',false,'code','HARD_LIMIT_EXCEEDED','remaining',jsonb_build_object('userMinute',greatest(0,v_ulm-v_user_minute),'userDay',greatest(0,v_uld-v_user_day),'userWeek',greatest(0,v_ulw-v_user_week),'workspaceMinute',greatest(0,v_wlm-v_workspace_minute),'workspaceDay',greatest(0,v_wld-v_workspace_day),'workspaceWeek',greatest(0,v_wlw-v_workspace_week)));
  end if;
  insert into v3.mcp_usage_reservations(workspace_id,user_id,api_key_id,request_id,idempotency_key,pool,units,metadata) values(p_workspace_id,p_user_id,p_api_key_id,p_request_id,p_idempotency_key,p_pool,p_units,p_metadata) returning * into v_existing;
  return jsonb_build_object('allowed',true,'reservationId',v_existing.id,'idempotent',false);
end $$;

revoke all on function v3.reserve_mcp_usage(uuid,uuid,uuid,uuid,text,text,integer,jsonb) from public, anon, authenticated;
grant execute on function v3.reserve_mcp_usage(uuid,uuid,uuid,uuid,text,text,integer,jsonb) to service_role;

commit;
