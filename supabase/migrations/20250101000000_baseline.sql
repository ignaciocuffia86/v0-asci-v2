-- ============================================================================
-- ASCI — Baseline de esquema (public + v3)
-- Generado desde la base de producción (Supabase: asciv2-database / grenlquhexbyneubtdub)
-- el 2026-08-12, por introspección de catálogos (pg_get_*def + pg_catalog).
--
-- Propósito: sellar el estado actual del esquema para que supabase/migrations/
-- sea una cadena coherente y ordenada. Corrige el check "Supabase Preview"
-- (que aplicaba 20260616000000_v3_multitenant.sql sin sus prerrequisitos) y
-- materializa la recomendación OPT-14 (migraciones versionadas con baseline).
--
-- Esta migración corre ANTES de 20260616000000_v3_multitenant.sql.
--
-- Notas:
--   - Solo esquema (DDL). NO incluye datos.
--   - Idempotente donde el motor lo permite (IF NOT EXISTS / guards).
--   - Las FKs se agregan después de crear todas las tablas (sin problemas de orden).
--   - Extensiones de public: pg_trgm, unaccent. El resto vive en schemas
--     administrados por Supabase (extensions, vault) presentes por defecto.
-- ============================================================================

create schema if not exists v3;

-- Extensiones
create extension if not exists pg_trgm with schema public;
create extension if not exists unaccent with schema public;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- search_path: las referencias no-calificadas a public (FKs a companies, tipos enum)
-- resuelven correctamente al aplicar la migración.
set search_path = public, v3, extensions;

-- Tipos enumerados
do $$ begin create type public.document_status as enum ('uploading', 'processing', 'ready', 'error'); exception when duplicate_object then null; end $$;
do $$ begin create type public.document_type as enum ('pdf', 'pptx', 'docx', 'url'); exception when duplicate_object then null; end $$;
do $$ begin create type public.tag_type as enum ('industry', 'technology', 'process'); exception when duplicate_object then null; end $$;

-- ============ TABLAS ============
create table if not exists public.admin_audit_log (
  id uuid default gen_random_uuid() not null,
  admin_id uuid not null,
  action text not null,
  target_user_id uuid,
  target_email text,
  details jsonb,
  created_at timestamp with time zone default now()
);

create table if not exists public.admin_prompts (
  id uuid default gen_random_uuid() not null,
  prompt_key text not null,
  prompt_text text not null,
  description text,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.apollo_api_calls (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  bookmark_id uuid,
  company_id uuid,
  endpoint text not null,
  request_body jsonb,
  response_status integer,
  response_total_entries integer,
  response_count integer,
  response_page integer,
  phone_revealed boolean default false,
  phone_sync boolean,
  latency_ms integer,
  error text,
  retry_count integer default 0,
  created_at timestamp with time zone default now(),
  query_hash text,
  credits_estimated integer default 0,
  metadata jsonb default '{}'::jsonb,
  response_body jsonb
);

create table if not exists public.apollo_contacts_cache (
  id uuid default gen_random_uuid() not null,
  apollo_id text,
  company_domain text,
  company_linkedin_url text,
  first_name text,
  last_name text,
  full_name text,
  title text,
  headline text,
  email text,
  email_status text,
  phone text,
  mobile_phone text,
  linkedin_url text,
  profile_picture_url text,
  city text,
  state text,
  country text,
  organization_name text,
  organization_website text,
  organization_linkedin_url text,
  organization_industry text,
  seniority text,
  departments jsonb,
  employment_history jsonb,
  job_titles_searched text[],
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.apollo_search_queries (
  id uuid default gen_random_uuid() not null,
  query_hash text not null,
  organization_id text,
  person_titles text[] default '{}'::text[] not null,
  person_locations text[] default '{}'::text[] not null,
  organization_locations text[] default '{}'::text[] not null,
  person_seniorities text[] default '{}'::text[] not null,
  person_departments text[] default '{}'::text[] not null,
  include_similar_titles boolean default true not null,
  total_entries integer default 0 not null,
  result_count integer default 0 not null,
  pages_fetched integer default 1 not null,
  reveal_email boolean default false not null,
  reveal_phone boolean default false not null,
  fetched_at timestamp with time zone default now() not null,
  fetched_by uuid,
  expires_at timestamp with time zone default (now() + '14 days'::interval) not null
);

create table if not exists public.apollo_search_results (
  query_id uuid not null,
  contact_cache_id uuid not null,
  "position" integer default 0 not null
);

create table if not exists public.apollo_title_catalog (
  normalized_title text not null,
  display_title text not null,
  language text,
  seniority text,
  department text,
  aliases text[] default '{}'::text[] not null,
  usage_count integer default 0 not null,
  success_count integer default 0 not null,
  last_success_entries integer default 0,
  first_seen_at timestamp with time zone default now() not null,
  last_seen_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.bookmark_summaries (
  id uuid default gen_random_uuid() not null,
  bookmark_id uuid not null,
  summary text not null,
  generated_at timestamp with time zone default now(),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  metadata jsonb default '{}'::jsonb,
  version integer default 1,
  fit_score integer,
  fit_reasons jsonb default '[]'::jsonb,
  risks jsonb default '[]'::jsonb,
  evidence jsonb default '[]'::jsonb,
  html_content text,
  context_hash text,
  user_email text
);

create table if not exists public.bookmarks (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  company_id uuid,
  notes text,
  priority text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  search_context jsonb default '{}'::jsonb,
  status text default 'nuevo'::text
);

create table if not exists public.companies (
  id uuid default gen_random_uuid() not null,
  name text not null,
  linkedin_url text,
  website text,
  industry text,
  country text,
  logo_url text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  normalized_name text,
  description text,
  linkedin_slug text,
  country_normalized text,
  master_industry_id text,
  is_public boolean,
  ticker character varying(10),
  cik character varying(10),
  stock_exchange character varying(50),
  public_status_checked_at timestamp with time zone,
  apollo_organization_id text,
  apollo_org_synced_at timestamp with time zone,
  apollo_employees_count integer,
  apollo_industry text,
  apollo_org_status text default 'unknown'::text,
  hq_country_iso text
);

create table if not exists public.company_implementations (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  bookmark_id uuid,
  company_id uuid not null,
  title text not null,
  provider_name text,
  technology text,
  summary text,
  results text,
  source_url text,
  source_name text,
  published_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  requested_at timestamp with time zone default now(),
  requested_by uuid,
  area text,
  evidence_level text,
  relevance_snippet text,
  ai_provider text,
  search_context text default 'general'::text,
  digest text,
  digest_generated_at timestamp with time zone,
  micro_agent text,
  evidence_detail text,
  convergent_sources integer default 1,
  supporting_source_urls jsonb default '[]'::jsonb,
  prompt_version text default 'v1'::text
);

create table if not exists public.company_news (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  bookmark_id uuid,
  company_id uuid not null,
  title text not null,
  summary text,
  source_url text,
  source_name text,
  published_at timestamp with time zone,
  relevance_tags text[],
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  requested_at timestamp with time zone default now(),
  requested_by uuid,
  category text,
  relevance_snippet text,
  ai_provider text,
  digest text,
  digest_generated_at timestamp with time zone,
  source text default 'parallel'::text not null,
  sourced_by_workspace uuid,
  verified_at timestamp with time zone,
  direction text
);

create table if not exists public.company_public_docs (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  bookmark_id uuid,
  user_id uuid not null,
  requested_by uuid,
  requested_at timestamp with time zone default now(),
  document_type text not null,
  document_title text not null,
  document_date date,
  fiscal_year integer,
  fiscal_quarter integer,
  source_url text not null,
  source_name text,
  document_language text,
  ticker character varying(10),
  findings jsonb default '[]'::jsonb not null,
  digest text,
  digest_generated_at timestamp with time zone,
  ai_provider text,
  extraction_method text,
  processing_error text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  tech_signals jsonb default '[]'::jsonb,
  content_extracted boolean default false,
  tech_snippets jsonb default '[]'::jsonb
);

create table if not exists public.contacts (
  id uuid default gen_random_uuid() not null,
  linkedin_url text not null,
  first_name text,
  last_name text,
  full_name text,
  headline text,
  about text,
  current_company_id uuid,
  current_position_title text,
  current_position_description text,
  current_position_started timestamp with time zone,
  previous_positions jsonb,
  country text,
  profile_picture_url text,
  processed boolean default false,
  processed_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  contact_info jsonb default '{}'::jsonb,
  email1 text,
  email1_type text,
  email1_status text,
  email2 text,
  email2_type text,
  email2_status text,
  email3 text,
  email3_type text,
  email3_status text,
  email4 text,
  email4_type text,
  email4_status text,
  phone1 text,
  phone1_type text,
  phone1_status text,
  phone2 text,
  phone2_type text,
  phone2_status text,
  country_normalized text
);

create table if not exists public.country_mappings (
  id uuid default gen_random_uuid() not null,
  raw_value text not null,
  normalized_country text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.cron_executions (
  id uuid default gen_random_uuid() not null,
  cron_name text not null,
  started_at timestamp with time zone default now() not null,
  completed_at timestamp with time zone,
  status text default 'running'::text,
  records_processed integer default 0,
  records_failed integer default 0,
  signals_created integer default 0,
  error_message text,
  details jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now()
);

create table if not exists public.cron_locks (
  lock_name text not null,
  holder text,
  locked_at timestamp with time zone,
  locked_until timestamp with time zone
);

create table if not exists public.debug_events (
  id uuid default gen_random_uuid() not null,
  batch_id uuid,
  event_type text,
  message text,
  details jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.dictionary_job_matches (
  job_id uuid not null,
  entity_type text not null,
  entity_id uuid not null
);

create table if not exists public.dictionary_jobs (
  id uuid default gen_random_uuid() not null,
  job_type text not null,
  signal_id uuid not null,
  signal_type text not null,
  keyword text,
  keywords text[],
  status text default 'pending'::text,
  progress integer default 0,
  total_records integer default 0,
  processed_records integer default 0,
  created_at timestamp with time zone default now(),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  error_message text,
  created_by text,
  contacts_processed integer default 0,
  contacts_total integer default 0,
  job_postings_processed integer default 0,
  job_postings_total integer default 0,
  phase text default 'contacts'::text,
  contacts_cursor uuid,
  job_postings_cursor uuid
);

create table if not exists public.dictionary_patterns_cache (
  id uuid default gen_random_uuid() not null,
  dict_type text not null,
  dict_id uuid not null,
  pattern text not null,
  keywords text[] not null,
  updated_at timestamp with time zone default now()
);

create table if not exists public.dictionary_processes (
  id uuid default gen_random_uuid() not null,
  name text not null,
  keywords text[],
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default now()
);

create table if not exists public.dictionary_products (
  id uuid default gen_random_uuid() not null,
  vendor_id uuid,
  name text not null,
  keywords text[],
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default now()
);

create table if not exists public.dictionary_vendors (
  id uuid default gen_random_uuid() not null,
  name text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.digest_send_log (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  items_count integer default 0 not null,
  companies_count integer default 0 not null,
  sent_at timestamp with time zone default now(),
  status text default 'sent'::text,
  error_message text
);

create table if not exists public.document_tags (
  id uuid default gen_random_uuid() not null,
  document_id uuid not null,
  user_id uuid not null,
  tag_type tag_type not null,
  tag_value text not null,
  tag_reference_id uuid,
  confidence real default 0.5 not null,
  created_at timestamp with time zone default now() not null,
  master_industry_id text
);

create table if not exists public.icebreaker_templates (
  id uuid default gen_random_uuid() not null,
  name text not null,
  description text,
  prompt_template text not null,
  tone text not null,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  created_by uuid
);

create table if not exists public.import_batches (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  filename text not null,
  status text default 'pending'::text not null,
  total_rows integer default 0,
  processed_rows integer default 0,
  error_message text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  failed_rows integer default 0,
  batch_type text default 'contacts'::text,
  consecutive_failures integer default 0,
  last_error text,
  skipped_rows integer default 0 not null
);

create table if not exists public.import_rows (
  id uuid default gen_random_uuid() not null,
  batch_id uuid not null,
  row_data jsonb not null,
  status text default 'pending'::text not null,
  error_message text,
  created_at timestamp with time zone default now(),
  processed_at timestamp with time zone
);

create table if not exists public.industry_mappings (
  id uuid default gen_random_uuid() not null,
  original_value text not null,
  source_type text default 'company'::text not null,
  master_industry_id text,
  is_auto_mapped boolean default false,
  mapped_at timestamp with time zone default now(),
  mapped_by uuid
);

create table if not exists public.ingestion_logs (
  id uuid default gen_random_uuid() not null,
  uploaded_by uuid,
  filename text,
  total_rows integer,
  processed_rows integer,
  new_contacts integer,
  updated_contacts integer,
  errors jsonb,
  status text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  completed_at timestamp with time zone
);

create table if not exists public.job_postings (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  title text not null,
  description text,
  location text,
  salary_range text,
  posted_at timestamp with time zone,
  is_active boolean default true,
  source_data jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  job_url text,
  apply_url text
);

create table if not exists public.landing_stats (
  id integer default 1 not null,
  contacts_analyzed bigint default 0 not null,
  companies_indexed bigint default 0 not null,
  technologies_processes integer default 0 not null,
  signals_detected bigint default 0 not null,
  refreshed_at timestamp with time zone default now() not null
);

create table if not exists public.master_industries (
  id text not null,
  name_en text not null,
  icon text not null,
  display_order integer default 0 not null,
  created_at timestamp with time zone default now(),
  name_es text not null
);

create table if not exists public.pending_signals (
  id uuid default gen_random_uuid() not null,
  contact_id uuid,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  processed_at timestamp with time zone,
  signal_type text default 'contact'::text,
  job_id uuid
);

create table if not exists public.profiles (
  id uuid not null,
  full_name text,
  company text,
  value_proposition text,
  role text default 'user'::text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  scheduled_deletion_at timestamp with time zone
);

create table if not exists public.radar_findings (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  run_id uuid,
  radar_type text not null,
  category text not null,
  title text not null,
  summary text,
  url text,
  source_name text,
  source_date date,
  evidence_level text default 'inferred'::text not null,
  confidence numeric(3,2),
  dictionary_product_ids uuid[] default '{}'::uuid[],
  dictionary_process_ids uuid[] default '{}'::uuid[],
  supporting_job_posting_ids uuid[] default '{}'::uuid[],
  payload jsonb,
  dedupe_hash text not null,
  detected_at timestamp with time zone default now() not null,
  micro_agent text,
  supporting_sources jsonb default '[]'::jsonb not null,
  convergent_sources integer default 1 not null
);

create table if not exists public.radar_research_runs (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  radar_type text not null,
  bundle text not null,
  model text not null,
  prompt_version text default 'v1'::text not null,
  raw_research text,
  structured jsonb,
  status text default 'completed'::text not null,
  error text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.resend_audiences (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  email text not null,
  full_name text,
  resend_contact_id text,
  sync_status text default 'pending'::text,
  last_sync_at timestamp with time zone,
  error_message text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.signals (
  id uuid default gen_random_uuid() not null,
  contact_id uuid,
  signal_type text,
  signal_id uuid,
  keyword_matched text,
  source_field text,
  company_id uuid,
  snippet text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  is_current_employee boolean default false,
  job_posting_id uuid,
  source_url text,
  job_posted_at timestamp with time zone
);

create table if not exists public.success_cases (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  title text not null,
  client_industry text,
  client_size text,
  challenge text,
  solution text,
  results text,
  technologies text[],
  case_url text,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.system_health_logs (
  id uuid default gen_random_uuid() not null,
  status text not null,
  alerts jsonb default '[]'::jsonb,
  stats jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now()
);

create table if not exists public.user_company_contacts (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  company_id uuid not null,
  first_name text,
  last_name text,
  full_name text,
  role text,
  email text,
  linkedin_url text,
  source text default 'system'::text,
  status text default 'new'::text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  bookmark_id uuid,
  apollo_cache_id uuid,
  headline text,
  profile_picture_url text,
  email_status text,
  phone text,
  mobile_phone text,
  city text,
  country text,
  seniority text,
  departments jsonb,
  is_decision_maker boolean default false,
  job_titles_searched text[],
  search_context jsonb,
  apollo_person_id text,
  last_verified_at timestamp with time zone,
  needs_review boolean default false,
  review_reason text,
  phone_status text default 'not_requested'::text,
  apollo_request_id text,
  phone_requested_at timestamp with time zone
);

create table if not exists public.user_company_signals (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  company_id uuid not null,
  title text,
  content text,
  source_url text,
  source_name text,
  signal_type text,
  published_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  bookmark_id uuid
);

create table if not exists public.user_company_strategies (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  company_id uuid not null,
  target_summary text,
  recommended_pitch text,
  website_content_snapshot text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  sender_context_override text,
  bookmark_id uuid,
  selected_doc_ids uuid[]
);

create table if not exists public.user_digest_sent_items (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  item_type text not null,
  item_id uuid not null,
  sent_at timestamp with time zone default now()
);

create table if not exists public.user_documents (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  title text not null,
  type document_type not null,
  source_url text,
  storage_path text,
  file_size bigint,
  status document_status default 'uploading'::document_status not null,
  processing_error text,
  extracted_text text,
  ai_summary text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  key_results text[] default '{}'::text[]
);

create table if not exists public.user_icebreakers (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  company_id uuid not null,
  contact_id uuid,
  generated_text text,
  template_used text,
  tone text,
  context_used text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  bookmark_id uuid,
  message_type text default 'linkedin'::text,
  contact_source text default 'private'::text,
  contact_name text
);

create table if not exists public.user_implementation_interactions (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  implementation_id uuid not null,
  company_id uuid not null,
  viewed_at timestamp with time zone default now(),
  notified_at timestamp with time zone,
  source text default 'search'::text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.user_news_interactions (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  news_id uuid not null,
  company_id uuid not null,
  viewed_at timestamp with time zone default now(),
  notified_at timestamp with time zone,
  source text default 'search'::text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.user_notification_preferences (
  user_id uuid not null,
  digest_enabled boolean default true,
  digest_frequency text default 'monthly'::text,
  last_digest_sent_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.user_onboarding (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  status text default 'pending'::text not null,
  current_track text,
  current_step integer default 0,
  completed_tracks text[] default '{}'::text[],
  progress_percentage integer default 0,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  skipped_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.user_public_doc_interactions (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  public_doc_id uuid not null,
  company_id uuid not null,
  viewed_at timestamp with time zone,
  notified_at timestamp with time zone,
  source text,
  created_at timestamp with time zone default now()
);

create table if not exists public.user_value_profiles (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  profile_summary text,
  target_industries jsonb default '[]'::jsonb,
  target_technologies jsonb default '[]'::jsonb,
  target_processes jsonb default '[]'::jsonb,
  raw_analysis jsonb,
  generated_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists v3.account_briefs (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  company_id uuid not null,
  research_job_id uuid,
  scorecard_id uuid,
  stage text not null,
  status text default 'ready'::text not null,
  headline text not null,
  why_now text,
  fit_summary text,
  evidence jsonb default '[]'::jsonb not null,
  recommended_contacts jsonb default '[]'::jsonb not null,
  next_actions jsonb default '[]'::jsonb not null,
  coverage jsonb default '{}'::jsonb not null,
  freshness jsonb default '{}'::jsonb not null,
  warnings jsonb default '[]'::jsonb not null,
  profile_version text,
  snapshot_version text,
  input_hash text not null,
  prompt_version text,
  model text,
  supersedes_brief_id uuid,
  created_at timestamp with time zone default now() not null,
  generation_mode text default 'server_managed'::text not null,
  client_execution_id uuid
);

create table if not exists v3.account_contacts (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  company_id uuid not null,
  apollo_cache_id uuid,
  apollo_person_id text,
  person_last_verified_at timestamp with time zone,
  email_last_verified_at timestamp with time zone,
  phone_last_verified_at timestamp with time zone,
  phone_status text default 'unknown'::text not null,
  phone_requested_at timestamp with time zone,
  apollo_request_id text,
  role_origin text default 'signal_derived'::text not null,
  matched_role text,
  first_seen_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists v3.account_evidence_details (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  company_id uuid not null,
  execution_id uuid,
  term_id uuid not null,
  term_kind text not null,
  term_name text not null,
  evidence_level text not null,
  mention_count integer default 0 not null,
  latest_at timestamp with time zone,
  sources jsonb default '[]'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists v3.account_internal_snapshots (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  company_id uuid not null,
  research_job_id uuid,
  snapshot_version text not null,
  profile_version text,
  status text not null,
  coverage jsonb default '{}'::jsonb not null,
  freshness jsonb default '{}'::jsonb not null,
  evidence jsonb default '{}'::jsonb not null,
  contacts jsonb default '[]'::jsonb not null,
  warnings jsonb default '[]'::jsonb not null,
  generated_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone default (now() + '24:00:00'::interval) not null
);

create table if not exists v3.account_scorecards (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  company_id uuid not null,
  research_job_id uuid,
  score smallint,
  fit_score smallint,
  buying_signals_score smallint,
  accessibility_score smallint,
  timing_score smallint,
  rationale text,
  dictionary_matches jsonb,
  signals_snapshot jsonb,
  created_at timestamp with time zone default now() not null,
  score_stage text default 'final'::text not null,
  fit_status text default 'evaluated'::text not null,
  profile_version text,
  snapshot_version text,
  supersedes_scorecard_id uuid,
  generation_mode text default 'server_managed'::text not null,
  client_execution_id uuid,
  prompt_version text
);

create table if not exists v3.ai_prompt_versions (
  id uuid default gen_random_uuid() not null,
  prompt_key text not null,
  content text not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null
);

create table if not exists v3.ai_prompts (
  id uuid default gen_random_uuid() not null,
  key text not null,
  content text not null,
  updated_by uuid,
  updated_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists v3.ai_usage_log (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid,
  user_id uuid,
  feature text not null,
  model text not null,
  input_tokens integer default 0 not null,
  output_tokens integer default 0 not null,
  cost_usd numeric(10,6) default 0 not null,
  company_id uuid,
  conversation_id uuid,
  metadata jsonb,
  created_at timestamp with time zone default now() not null,
  api_key_id uuid,
  request_id uuid,
  research_job_id uuid,
  generation_mode text default 'server_managed'::text not null
);

create table if not exists v3.bookmark_dedupe_log (
  id uuid default gen_random_uuid() not null,
  batch_id uuid not null,
  keep_id uuid not null,
  entry jsonb not null,
  created_at timestamp with time zone default now() not null,
  reverted_at timestamp with time zone
);

create table if not exists v3.buyer_personas (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  name text not null,
  description text,
  recommended_job_titles text[] default '{}'::text[],
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  is_auto boolean default false not null,
  source text default 'manual'::text not null
);

create table if not exists v3.campaign_account_digest (
  id uuid default gen_random_uuid() not null,
  campaign_account_id uuid not null,
  news_ids uuid[] default '{}'::uuid[],
  implementation_ids uuid[] default '{}'::uuid[],
  contact_ids uuid[] default '{}'::uuid[],
  buyer_persona_id uuid,
  signal_types_matched text[] default '{}'::text[],
  recommended_job_titles text[] default '{}'::text[],
  last_fetched_at timestamp with time zone,
  new_items_count integer default 0 not null,
  last_user_seen_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists v3.campaign_accounts (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  company_id uuid not null,
  status text default 'whitelisted'::text not null,
  match_source text default 'manual'::text not null,
  prospection_status text,
  tech_radar_run_at timestamp with time zone,
  apollo_run_at timestamp with time zone,
  added_at timestamp with time zone default now() not null,
  added_by uuid not null
);

create table if not exists v3.campaigns (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  created_by uuid not null,
  name text not null,
  type text not null,
  buyer_persona_id uuid,
  buyer_persona_text text,
  country_filter text[],
  account_count integer default 0 not null,
  max_accounts integer default 100 not null,
  enable_tech_radar boolean default true not null,
  enable_apollo boolean default true not null,
  enable_email_agent boolean default false not null,
  enable_signals_only boolean default false not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists v3.chat_conversations (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  user_id uuid not null,
  title text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists v3.chat_messages (
  id uuid default gen_random_uuid() not null,
  conversation_id uuid not null,
  role text not null,
  parts jsonb default '[]'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists v3.client_ai_executions (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  user_id uuid not null,
  api_key_id uuid,
  reservation_id uuid not null,
  feature text not null,
  company_id uuid not null,
  contact_id text,
  current_stage text not null,
  status text default 'prepared'::text not null,
  prompt_version text not null,
  package_hash text not null,
  package_payload jsonb not null,
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone default now() not null,
  completed_at timestamp with time zone,
  oauth_token_id uuid,
  principal_id uuid generated always as (COALESCE(api_key_id, oauth_token_id)) stored,
  batch_size integer default 1 not null,
  refreshed_count integer default 0 not null,
  refresh_count integer default 0 not null
);

create table if not exists v3.client_ai_stage_submissions (
  id uuid default gen_random_uuid() not null,
  execution_id uuid not null,
  workspace_id uuid not null,
  stage text not null,
  package_hash text not null,
  idempotency_key text not null,
  result jsonb not null,
  validation_report jsonb default '{}'::jsonb not null,
  client_model text,
  status text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists v3.company_dup_candidates (
  id uuid default gen_random_uuid() not null,
  group_key text not null,
  method text not null,
  company_ids uuid[] not null,
  master_id uuid not null,
  classification text not null,
  payload jsonb not null,
  status text default 'pending'::text not null,
  ai_confidence numeric,
  ai_reasoning text,
  ai_checked_at timestamp with time zone,
  merge_ids uuid[],
  error_message text,
  created_at timestamp with time zone default now() not null,
  resolved_at timestamp with time zone
);

create table if not exists v3.company_dup_groups (
  group_key text not null,
  company_ids uuid[] not null,
  n integer not null,
  peso bigint default 0 not null,
  promoted_at timestamp with time zone,
  detected_at timestamp with time zone default now() not null
);

create table if not exists v3.company_merges (
  id uuid default gen_random_uuid() not null,
  master_id uuid not null,
  duplicate_id uuid not null,
  duplicate_snapshot jsonb not null,
  moved jsonb default '{}'::jsonb not null,
  deleted jsonb default '{}'::jsonb not null,
  method text default 'manual'::text not null,
  confidence numeric,
  reasoning text,
  decided_by uuid,
  created_at timestamp with time zone default now() not null,
  reverted_at timestamp with time zone,
  cascade_deleted jsonb,
  follow_merge jsonb,
  bookmark_merge jsonb
);

create table if not exists v3.company_name_index (
  company_id uuid not null,
  name_snapshot text not null,
  core text,
  weight integer default 0 not null,
  refreshed_at timestamp with time zone default now() not null,
  n_jobs integer default 0 not null,
  n_contacts integer default 0 not null,
  n_news integer default 0 not null
);

create table if not exists v3.contact_enrichment_runs (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  user_id uuid not null,
  api_key_id uuid,
  company_id uuid not null,
  plan_hash text not null,
  plan_payload jsonb not null,
  reservation_id uuid,
  idempotency_key text not null,
  status text default 'prepared'::text not null,
  contacts_found integer default 0 not null,
  contacts_with_email integer default 0 not null,
  credits_spent integer default 0 not null,
  cache_hit boolean default false not null,
  error_message text,
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone default now() not null,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  oauth_token_id uuid,
  principal_id uuid generated always as (COALESCE(api_key_id, oauth_token_id)) stored
);

create table if not exists v3.conversation_memory (
  conversation_id uuid not null,
  workspace_id uuid not null,
  summary text default ''::text not null,
  active_entities jsonb default '[]'::jsonb not null,
  preferences jsonb default '{}'::jsonb not null,
  result_references jsonb default '[]'::jsonb not null,
  version integer default 1 not null,
  compacted_through timestamp with time zone,
  updated_at timestamp with time zone default now() not null
);

create table if not exists v3.dictionary_job_titles (
  id uuid default gen_random_uuid() not null,
  job_title text not null,
  process_id uuid,
  product_id uuid,
  seniority text,
  created_at timestamp with time zone default now() not null
);

create table if not exists v3.dictionary_term_suggestions (
  id uuid default gen_random_uuid() not null,
  term text not null,
  normalized_term text not null,
  suggested_type text not null,
  vendor_hint text,
  evidence jsonb default '[]'::jsonb not null,
  occurrences integer default 1 not null,
  status text default 'pending'::text not null,
  suggested_by_agent text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists v3.digest_log (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  followed_account_id uuid not null,
  recipients jsonb default '[]'::jsonb not null,
  novelty_summary jsonb,
  score_before smallint,
  score_after smallint,
  sent_at timestamp with time zone default now() not null
);

create table if not exists v3.explore_sessions (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  user_id uuid not null,
  concept text,
  terms text[] default '{}'::text[] not null,
  country text,
  industry_ids text[] default '{}'::text[] not null,
  include_unclassified boolean default true not null,
  sources text[] default ARRAY['contacts'::text, 'jobs'::text] not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone default (now() + '7 days'::interval) not null
);

create table if not exists v3.followed_account_subscribers (
  id uuid default gen_random_uuid() not null,
  followed_account_id uuid not null,
  workspace_id uuid not null,
  user_id uuid not null,
  subscribed boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists v3.followed_accounts (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  company_id uuid not null,
  followed_by uuid not null,
  is_active boolean default true not null,
  refresh_day smallint default 1 not null,
  last_refreshed_at timestamp with time zone,
  unfollowed_at timestamp with time zone,
  unfollowed_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  last_refresh_attempt_at timestamp with time zone,
  refresh_attempts integer default 0 not null
);

create table if not exists v3.icebreakers (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  company_id uuid not null,
  research_job_id uuid,
  contact_apollo_id text,
  contact_name text not null,
  contact_title text,
  contact_country text,
  language_register text default 'es-neutral'::text not null,
  content text not null,
  evidence jsonb,
  version integer default 1 not null,
  regenerated_from uuid,
  regeneration_instruction text,
  feedback smallint,
  feedback_note text,
  created_by uuid not null,
  created_at timestamp with time zone default now() not null,
  generation_mode text default 'server_managed'::text not null,
  client_execution_id uuid,
  prompt_version text,
  model text
);

create table if not exists v3.linkedin_company_enrichment (
  company_id uuid not null,
  requested_url text,
  mode text default 'companies'::text not null,
  status text not null,
  hq_iso text,
  hq_country text,
  hq_source text,
  payload jsonb,
  filled_columns text[] default '{}'::text[] not null,
  error_message text,
  processed_at timestamp with time zone default now() not null,
  attempts integer default 0 not null,
  next_attempt_at timestamp with time zone
);

create table if not exists v3.mcp_api_keys (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  name text not null,
  key_hash text not null,
  key_prefix text not null,
  rate_limit_per_minute integer default 60 not null,
  request_count integer default 0 not null,
  created_by uuid not null,
  created_at timestamp with time zone default now() not null,
  last_used_at timestamp with time zone,
  revoked_at timestamp with time zone,
  scopes text[] default '{read}'::text[] not null,
  owner_user_id uuid not null,
  allowed_modes text[] default ARRAY['read'::text] not null
);

create table if not exists v3.mcp_document_drafts (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  created_by uuid not null,
  title text not null,
  source_type text not null,
  source_url text,
  storage_path text,
  mime_type text,
  file_size bigint,
  content_hash text,
  extracted_text text,
  status text default 'pending_upload'::text not null,
  error_message text,
  analysis jsonb,
  confirmed_document_id uuid,
  expires_at timestamp with time zone default (now() + '7 days'::interval) not null,
  confirmed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists v3.mcp_document_upload_tokens (
  id uuid default gen_random_uuid() not null,
  draft_id uuid not null,
  workspace_id uuid not null,
  user_id uuid not null,
  token_hash text not null,
  expires_at timestamp with time zone not null,
  used_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table if not exists v3.mcp_oauth_authorization_codes (
  id uuid default gen_random_uuid() not null,
  code_hash text not null,
  client_id text not null,
  user_id uuid not null,
  workspace_id uuid not null,
  redirect_uri text not null,
  scopes text[] not null,
  code_challenge text not null,
  code_challenge_method text default 'S256'::text not null,
  expires_at timestamp with time zone not null,
  used_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table if not exists v3.mcp_oauth_clients (
  id uuid default gen_random_uuid() not null,
  client_id text not null,
  client_secret_hash text,
  client_name text default 'MCP Client'::text not null,
  redirect_uris text[] not null,
  token_endpoint_auth_method text default 'none'::text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists v3.mcp_oauth_tokens (
  id uuid default gen_random_uuid() not null,
  token_hash text not null,
  refresh_token_hash text,
  client_id text not null,
  user_id uuid not null,
  workspace_id uuid not null,
  scopes text[] not null,
  expires_at timestamp with time zone not null,
  refresh_expires_at timestamp with time zone,
  revoked_at timestamp with time zone,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table if not exists v3.mcp_request_logs (
  id uuid default gen_random_uuid() not null,
  api_key_id uuid,
  endpoint text not null,
  method text not null,
  status_code integer not null,
  response_time_ms integer,
  created_at timestamp with time zone default now() not null,
  workspace_id uuid,
  user_id uuid,
  tool_name text,
  mode text default 'read'::text not null,
  request_id uuid,
  idempotency_key text,
  units integer default 0 not null,
  error_code text,
  metadata jsonb default '{}'::jsonb not null,
  oauth_token_id uuid,
  principal_id uuid generated always as (COALESCE(api_key_id, oauth_token_id)) stored
);

create table if not exists v3.mcp_usage_reservations (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  user_id uuid not null,
  api_key_id uuid,
  request_id uuid not null,
  idempotency_key text not null,
  pool text not null,
  units integer not null,
  status text default 'reserved'::text not null,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  committed_at timestamp with time zone,
  released_at timestamp with time zone,
  oauth_token_id uuid,
  principal_id uuid generated always as (COALESCE(api_key_id, oauth_token_id)) stored
);

create table if not exists v3.radar_micro_agents (
  id uuid default gen_random_uuid() not null,
  key text not null,
  label text not null,
  description text,
  radar_type text default 'tech'::text not null,
  focus_prompt text not null,
  dictionary_product_ids uuid[] default '{}'::uuid[] not null,
  dictionary_process_ids uuid[] default '{}'::uuid[] not null,
  keywords text[] default '{}'::text[] not null,
  enabled boolean default true not null,
  priority integer default 100 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists v3.research_jobs (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  conversation_id uuid,
  batch_id uuid default gen_random_uuid() not null,
  company_id uuid,
  company_input text not null,
  resolved_domain text,
  resolved_country text,
  status text default 'pending'::text not null,
  current_step text,
  progress integer default 0 not null,
  force_refresh boolean default false not null,
  error text,
  requested_by uuid not null,
  created_at timestamp with time zone default now() not null,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  source text default 'user'::text not null,
  phase text default 'internal'::text not null,
  heartbeat_at timestamp with time zone,
  lease_expires_at timestamp with time zone,
  worker_id text,
  attempt_count integer default 0 not null,
  max_attempts integer default 3 not null,
  error_code text,
  last_error_at timestamp with time zone,
  next_retry_at timestamp with time zone,
  cancel_requested_at timestamp with time zone,
  preliminary_ready_at timestamp with time zone,
  external_started_at timestamp with time zone,
  resolution_matched_by text,
  resolution_confidence numeric,
  resolution_reason text,
  original_company_id uuid
);

create table if not exists v3.research_stage_runs (
  id uuid default gen_random_uuid() not null,
  research_job_id uuid not null,
  workspace_id uuid not null,
  stage text not null,
  status text default 'pending'::text not null,
  attempt integer default 1 not null,
  input_hash text not null,
  output_reference jsonb,
  error_code text,
  error_message text,
  heartbeat_at timestamp with time zone,
  lease_expires_at timestamp with time zone,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table if not exists v3.tech_radar_runs (
  id uuid default gen_random_uuid() not null,
  company_id uuid,
  company_name text not null,
  workspace_id uuid,
  user_id uuid,
  caller text not null,
  campaign_account_id uuid,
  bookmark_id uuid,
  keywords text[] default '{}'::text[] not null,
  status text default 'running'::text not null,
  model text,
  web_searches integer default 0 not null,
  sources_count integer default 0 not null,
  findings_count integer default 0 not null,
  input_tokens bigint default 0 not null,
  output_tokens bigint default 0 not null,
  cost_usd numeric(12,6) default 0 not null,
  digest text,
  ai_provider text,
  error_message text,
  started_at timestamp with time zone default now() not null,
  completed_at timestamp with time zone,
  duration_ms integer,
  created_at timestamp with time zone default now() not null
);

create table if not exists v3.workspace_document_tags (
  id uuid default gen_random_uuid() not null,
  document_id uuid not null,
  workspace_id uuid not null,
  tag_type text not null,
  tag_value text not null,
  tag_reference_id uuid,
  confidence numeric(3,2) default 1.0,
  created_at timestamp with time zone default now() not null
);

create table if not exists v3.workspace_documents (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  uploaded_by uuid not null,
  title text not null,
  type text not null,
  source_url text,
  storage_path text,
  file_size integer,
  status text default 'processing'::text not null,
  processing_error text,
  extracted_text text,
  ai_summary text,
  version integer default 1 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  processing_progress integer default 0,
  inferred_persona jsonb,
  recommended_job_titles text[] default '{}'::text[] not null
);

create table if not exists v3.workspace_invitations (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  email text not null,
  role text default 'member'::text not null,
  token text not null,
  status text default 'pending'::text not null,
  invited_by uuid not null,
  accepted_by uuid,
  expires_at timestamp with time zone default (now() + '7 days'::interval) not null,
  created_at timestamp with time zone default now() not null,
  accepted_at timestamp with time zone
);

create table if not exists v3.workspace_members (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  user_id uuid not null,
  role text default 'member'::text not null,
  status text default 'active'::text not null,
  invited_by uuid,
  invited_at timestamp with time zone default now() not null,
  joined_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table if not exists v3.workspace_value_profiles (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  profile_summary text,
  target_industries jsonb default '[]'::jsonb,
  target_technologies jsonb default '[]'::jsonb,
  target_processes jsonb default '[]'::jsonb,
  raw_analysis jsonb,
  generated_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists v3.workspaces (
  id uuid default gen_random_uuid() not null,
  domain text not null,
  name text not null,
  website_url text,
  created_by uuid not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  plan text default 'trial'::text not null
);

-- ============ CONSTRAINTS (PK/UNIQUE/CHECK) ============
alter table public.admin_audit_log add constraint admin_audit_log_pkey PRIMARY KEY (id);
alter table public.admin_prompts add constraint admin_prompts_pkey PRIMARY KEY (id);
alter table public.admin_prompts add constraint admin_prompts_prompt_key_key UNIQUE (prompt_key);
alter table public.apollo_api_calls add constraint apollo_api_calls_pkey PRIMARY KEY (id);
alter table public.apollo_contacts_cache add constraint apollo_contacts_cache_apollo_id_key UNIQUE (apollo_id);
alter table public.apollo_contacts_cache add constraint apollo_contacts_cache_pkey PRIMARY KEY (id);
alter table public.apollo_search_queries add constraint apollo_search_queries_pkey PRIMARY KEY (id);
alter table public.apollo_search_queries add constraint apollo_search_queries_query_hash_key UNIQUE (query_hash);
alter table public.apollo_search_results add constraint apollo_search_results_pkey PRIMARY KEY (query_id, contact_cache_id);
alter table public.apollo_title_catalog add constraint apollo_title_catalog_pkey PRIMARY KEY (normalized_title);
alter table public.bookmark_summaries add constraint bookmark_summaries_bookmark_id_key UNIQUE (bookmark_id);
alter table public.bookmark_summaries add constraint bookmark_summaries_pkey PRIMARY KEY (id);
alter table public.bookmarks add constraint bookmarks_pkey PRIMARY KEY (id);
alter table public.bookmarks add constraint bookmarks_priority_check CHECK ((priority = ANY (ARRAY['alta'::text, 'transaccional'::text, 'baja'::text])));
alter table public.bookmarks add constraint bookmarks_status_check CHECK ((status = ANY (ARRAY['nuevo'::text, 'investigando'::text, 'contactado'::text, 'respondio'::text, 'reunion'::text, 'descartado'::text])));
alter table public.companies add constraint companies_linkedin_url_key UNIQUE (linkedin_url);
alter table public.companies add constraint companies_name_key UNIQUE (name);
alter table public.companies add constraint companies_pkey PRIMARY KEY (id);
alter table public.company_implementations add constraint company_implementations_pkey PRIMARY KEY (id);
alter table public.company_news add constraint company_news_direction_check CHECK (((direction IS NULL) OR (direction = ANY (ARRAY['expansion'::text, 'contraccion'::text, 'neutro'::text]))));
alter table public.company_news add constraint company_news_pkey PRIMARY KEY (id);
alter table public.company_news add constraint company_news_source_check CHECK ((source = ANY (ARRAY['parallel'::text, 'client_mcp'::text, 'tech_radar'::text])));
alter table public.company_public_docs add constraint company_public_docs_pkey PRIMARY KEY (id);
alter table public.contacts add constraint contacts_linkedin_url_key UNIQUE (linkedin_url);
alter table public.contacts add constraint contacts_pkey PRIMARY KEY (id);
alter table public.country_mappings add constraint country_mappings_pkey PRIMARY KEY (id);
alter table public.country_mappings add constraint country_mappings_raw_value_key UNIQUE (raw_value);
alter table public.cron_executions add constraint cron_executions_pkey PRIMARY KEY (id);
alter table public.cron_executions add constraint cron_executions_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])));
alter table public.cron_locks add constraint cron_locks_pkey PRIMARY KEY (lock_name);
alter table public.debug_events add constraint debug_events_pkey PRIMARY KEY (id);
alter table public.dictionary_job_matches add constraint dictionary_job_matches_pkey PRIMARY KEY (job_id, entity_type, entity_id);
alter table public.dictionary_jobs add constraint dictionary_jobs_job_type_check CHECK ((job_type = ANY (ARRAY['add_keyword'::text, 'remove_keyword'::text, 'add_product'::text, 'add_process'::text, 'update_product'::text, 'update_process'::text])));
alter table public.dictionary_jobs add constraint dictionary_jobs_pkey PRIMARY KEY (id);
alter table public.dictionary_jobs add constraint dictionary_jobs_signal_type_check CHECK ((signal_type = ANY (ARRAY['technology'::text, 'process'::text])));
alter table public.dictionary_jobs add constraint dictionary_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])));
alter table public.dictionary_patterns_cache add constraint dictionary_patterns_cache_dict_type_dict_id_key UNIQUE (dict_type, dict_id);
alter table public.dictionary_patterns_cache add constraint dictionary_patterns_cache_pkey PRIMARY KEY (id);
alter table public.dictionary_processes add constraint dictionary_processes_pkey PRIMARY KEY (id);
alter table public.dictionary_products add constraint dictionary_products_pkey PRIMARY KEY (id);
alter table public.dictionary_vendors add constraint dictionary_vendors_pkey PRIMARY KEY (id);
alter table public.digest_send_log add constraint digest_send_log_pkey PRIMARY KEY (id);
alter table public.digest_send_log add constraint digest_send_log_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'failed'::text, 'skipped'::text])));
alter table public.document_tags add constraint document_tags_pkey PRIMARY KEY (id);
alter table public.icebreaker_templates add constraint icebreaker_templates_pkey PRIMARY KEY (id);
alter table public.import_batches add constraint import_batches_pkey PRIMARY KEY (id);
alter table public.import_batches add constraint import_batches_status_check CHECK ((status = ANY (ARRAY['uploading'::text, 'pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])));
alter table public.import_rows add constraint import_rows_pkey PRIMARY KEY (id);
alter table public.import_rows add constraint import_rows_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processed'::text, 'failed'::text, 'skipped'::text])));
alter table public.industry_mappings add constraint industry_mappings_pkey PRIMARY KEY (id);
alter table public.industry_mappings add constraint unique_mapping_per_source UNIQUE (original_value, source_type);
alter table public.industry_mappings add constraint valid_source_type CHECK ((source_type = ANY (ARRAY['company'::text, 'document'::text])));
alter table public.ingestion_logs add constraint ingestion_logs_pkey PRIMARY KEY (id);
alter table public.ingestion_logs add constraint ingestion_logs_status_check CHECK ((status = ANY (ARRAY['processing'::text, 'completed'::text, 'failed'::text])));
alter table public.job_postings add constraint job_postings_job_url_key UNIQUE (job_url);
alter table public.job_postings add constraint job_postings_pkey PRIMARY KEY (id);
alter table public.landing_stats add constraint landing_stats_pkey PRIMARY KEY (id);
alter table public.landing_stats add constraint landing_stats_singleton CHECK ((id = 1));
alter table public.master_industries add constraint master_industries_pkey PRIMARY KEY (id);
alter table public.pending_signals add constraint pending_signals_pkey PRIMARY KEY (id);
alter table public.pending_signals add constraint pending_signals_signal_type_check CHECK ((signal_type = ANY (ARRAY['contact'::text, 'job'::text])));
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_role_check CHECK ((role = ANY (ARRAY['user'::text, 'superadmin'::text])));
alter table public.radar_findings add constraint radar_findings_company_id_dedupe_hash_key UNIQUE (company_id, dedupe_hash);
alter table public.radar_findings add constraint radar_findings_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)));
alter table public.radar_findings add constraint radar_findings_evidence_level_check CHECK ((evidence_level = ANY (ARRAY['explicit'::text, 'inferred'::text, 'Confirmado'::text, 'Probable'::text, 'Inferido'::text])));
alter table public.radar_findings add constraint radar_findings_pkey PRIMARY KEY (id);
alter table public.radar_findings add constraint radar_findings_radar_type_check CHECK ((radar_type = ANY (ARRAY['tech'::text, 'news'::text, 'jobs-interpretation'::text])));
alter table public.radar_research_runs add constraint radar_research_runs_pkey PRIMARY KEY (id);
alter table public.radar_research_runs add constraint radar_research_runs_radar_type_check CHECK ((radar_type = ANY (ARRAY['tech'::text, 'news'::text, 'jobs-interpretation'::text])));
alter table public.radar_research_runs add constraint radar_research_runs_status_check CHECK ((status = ANY (ARRAY['completed'::text, 'failed'::text])));
alter table public.resend_audiences add constraint resend_audiences_pkey PRIMARY KEY (id);
alter table public.resend_audiences add constraint resend_audiences_sync_status_check CHECK ((sync_status = ANY (ARRAY['pending'::text, 'synced'::text, 'failed'::text])));
alter table public.resend_audiences add constraint resend_audiences_user_id_key UNIQUE (user_id);
alter table public.signals add constraint signals_job_posting_signal_unique UNIQUE (job_posting_id, signal_type, signal_id);
alter table public.signals add constraint signals_pkey PRIMARY KEY (id);
alter table public.signals add constraint signals_signal_type_check CHECK ((signal_type = ANY (ARRAY['technology'::text, 'process'::text])));
alter table public.signals add constraint unique_signal_per_contact_company_dict UNIQUE (contact_id, company_id, signal_type, signal_id);
alter table public.success_cases add constraint success_cases_pkey PRIMARY KEY (id);
alter table public.system_health_logs add constraint system_health_logs_pkey PRIMARY KEY (id);
alter table public.system_health_logs add constraint system_health_logs_status_check CHECK ((status = ANY (ARRAY['healthy'::text, 'degraded'::text, 'critical'::text])));
alter table public.user_company_contacts add constraint user_company_contacts_phone_status_check CHECK ((phone_status = ANY (ARRAY['not_requested'::text, 'pending'::text, 'received'::text, 'not_available'::text])));
alter table public.user_company_contacts add constraint user_company_contacts_pkey PRIMARY KEY (id);
alter table public.user_company_signals add constraint user_company_signals_pkey PRIMARY KEY (id);
alter table public.user_company_strategies add constraint user_company_strategies_bookmark_user_unique UNIQUE (bookmark_id, user_id);
alter table public.user_company_strategies add constraint user_company_strategies_pkey PRIMARY KEY (id);
alter table public.user_digest_sent_items add constraint user_digest_sent_items_item_type_check CHECK ((item_type = ANY (ARRAY['news'::text, 'implementation'::text])));
alter table public.user_digest_sent_items add constraint user_digest_sent_items_pkey PRIMARY KEY (id);
alter table public.user_digest_sent_items add constraint user_digest_sent_items_user_id_item_type_item_id_key UNIQUE (user_id, item_type, item_id);
alter table public.user_documents add constraint user_documents_pkey PRIMARY KEY (id);
alter table public.user_icebreakers add constraint user_icebreakers_message_type_check CHECK ((message_type = ANY (ARRAY['linkedin'::text, 'email'::text])));
alter table public.user_icebreakers add constraint user_icebreakers_pkey PRIMARY KEY (id);
alter table public.user_implementation_interactions add constraint user_implementation_interactions_pkey PRIMARY KEY (id);
alter table public.user_implementation_interactions add constraint user_implementation_interactions_user_id_implementation_id_key UNIQUE (user_id, implementation_id);
alter table public.user_news_interactions add constraint user_news_interactions_pkey PRIMARY KEY (id);
alter table public.user_news_interactions add constraint user_news_interactions_user_id_news_id_key UNIQUE (user_id, news_id);
alter table public.user_notification_preferences add constraint user_notification_preferences_digest_frequency_check CHECK ((digest_frequency = ANY (ARRAY['weekly'::text, 'monthly'::text, 'never'::text])));
alter table public.user_notification_preferences add constraint user_notification_preferences_pkey PRIMARY KEY (user_id);
alter table public.user_onboarding add constraint user_onboarding_current_track_check CHECK ((current_track = ANY (ARRAY['segmentacion'::text, 'documentacion'::text, 'prospeccion'::text])));
alter table public.user_onboarding add constraint user_onboarding_pkey PRIMARY KEY (id);
alter table public.user_onboarding add constraint user_onboarding_progress_percentage_check CHECK (((progress_percentage >= 0) AND (progress_percentage <= 100)));
alter table public.user_onboarding add constraint user_onboarding_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'skipped'::text, 'completed'::text])));
alter table public.user_onboarding add constraint user_onboarding_user_id_key UNIQUE (user_id);
alter table public.user_public_doc_interactions add constraint user_public_doc_interactions_pkey PRIMARY KEY (id);
alter table public.user_public_doc_interactions add constraint user_public_doc_interactions_user_id_public_doc_id_key UNIQUE (user_id, public_doc_id);
alter table public.user_value_profiles add constraint unique_user_value_profile UNIQUE (user_id);
alter table public.user_value_profiles add constraint user_value_profiles_pkey PRIMARY KEY (id);
alter table v3.account_briefs add constraint account_briefs_pkey PRIMARY KEY (id);
alter table v3.account_briefs add constraint account_briefs_stage_check CHECK ((stage = ANY (ARRAY['preliminary'::text, 'final'::text])));
alter table v3.account_briefs add constraint account_briefs_status_check CHECK ((status = ANY (ARRAY['ready'::text, 'partial'::text, 'failed'::text])));
alter table v3.account_briefs add constraint account_briefs_workspace_id_company_id_stage_input_hash_key UNIQUE (workspace_id, company_id, stage, input_hash);
alter table v3.account_contacts add constraint account_contacts_phone_status_check CHECK ((phone_status = ANY (ARRAY['unknown'::text, 'not_requested'::text, 'processing'::text, 'available'::text, 'unavailable'::text, 'failed'::text])));
alter table v3.account_contacts add constraint account_contacts_pkey PRIMARY KEY (id);
alter table v3.account_contacts add constraint account_contacts_role_origin_check CHECK ((role_origin = ANY (ARRAY['signal_derived'::text, 'user_input'::text])));
alter table v3.account_evidence_details add constraint account_evidence_details_evidence_level_check CHECK ((evidence_level = ANY (ARRAY['Confirmado'::text, 'Probable'::text, 'Inferido'::text])));
alter table v3.account_evidence_details add constraint account_evidence_details_pkey PRIMARY KEY (id);
alter table v3.account_evidence_details add constraint account_evidence_details_term_kind_check CHECK ((term_kind = ANY (ARRAY['product'::text, 'process'::text])));
alter table v3.account_evidence_details add constraint account_evidence_details_workspace_id_company_id_term_id_ex_key UNIQUE (workspace_id, company_id, term_id, execution_id);
alter table v3.account_internal_snapshots add constraint account_internal_snapshots_pkey PRIMARY KEY (id);
alter table v3.account_internal_snapshots add constraint account_internal_snapshots_status_check CHECK ((status = ANY (ARRAY['ready'::text, 'partial'::text, 'failed'::text])));
alter table v3.account_internal_snapshots add constraint account_internal_snapshots_workspace_id_company_id_snapshot_key UNIQUE (workspace_id, company_id, snapshot_version, profile_version);
alter table v3.account_scorecards add constraint account_scorecards_accessibility_score_check CHECK (((accessibility_score >= 0) AND (accessibility_score <= 100)));
alter table v3.account_scorecards add constraint account_scorecards_buying_signals_score_check CHECK (((buying_signals_score >= 0) AND (buying_signals_score <= 100)));
alter table v3.account_scorecards add constraint account_scorecards_fit_score_check CHECK (((fit_score >= 0) AND (fit_score <= 100)));
alter table v3.account_scorecards add constraint account_scorecards_fit_status_check CHECK ((fit_status = ANY (ARRAY['evaluated'::text, 'fit_not_evaluated'::text])));
alter table v3.account_scorecards add constraint account_scorecards_pkey PRIMARY KEY (id);
alter table v3.account_scorecards add constraint account_scorecards_score_check CHECK (((score >= 0) AND (score <= 100)));
alter table v3.account_scorecards add constraint account_scorecards_score_stage_check CHECK ((score_stage = ANY (ARRAY['preliminary'::text, 'final'::text])));
alter table v3.account_scorecards add constraint account_scorecards_timing_score_check CHECK (((timing_score >= 0) AND (timing_score <= 100)));
alter table v3.ai_prompt_versions add constraint ai_prompt_versions_pkey PRIMARY KEY (id);
alter table v3.ai_prompts add constraint ai_prompts_key_key UNIQUE (key);
alter table v3.ai_prompts add constraint ai_prompts_pkey PRIMARY KEY (id);
alter table v3.ai_usage_log add constraint ai_usage_log_feature_check CHECK ((feature = ANY (ARRAY['chat'::text, 'radar-tech'::text, 'radar-news'::text, 'jobs-interpretation'::text, 'scoring'::text, 'icebreaker'::text, 'doc-analysis'::text, 'dedupe'::text, 'research-collect'::text, 'research-structure'::text, 'research-synthesis'::text, 'other'::text])));
alter table v3.ai_usage_log add constraint ai_usage_log_pkey PRIMARY KEY (id);
alter table v3.bookmark_dedupe_log add constraint bookmark_dedupe_log_pkey PRIMARY KEY (id);
alter table v3.buyer_personas add constraint buyer_personas_pkey PRIMARY KEY (id);
alter table v3.buyer_personas add constraint buyer_personas_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'auto_docs'::text])));
alter table v3.campaign_account_digest add constraint campaign_account_digest_campaign_account_id_key UNIQUE (campaign_account_id);
alter table v3.campaign_account_digest add constraint campaign_account_digest_pkey PRIMARY KEY (id);
alter table v3.campaign_accounts add constraint campaign_accounts_campaign_id_company_id_key UNIQUE (campaign_id, company_id);
alter table v3.campaign_accounts add constraint campaign_accounts_match_source_check CHECK ((match_source = ANY (ARRAY['csv_import'::text, 'manual'::text, 'asci_recommendation'::text])));
alter table v3.campaign_accounts add constraint campaign_accounts_pkey PRIMARY KEY (id);
alter table v3.campaign_accounts add constraint campaign_accounts_prospection_status_check CHECK ((prospection_status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text])));
alter table v3.campaign_accounts add constraint campaign_accounts_status_check CHECK ((status = ANY (ARRAY['whitelisted'::text, 'blacklisted'::text, 'pending_match'::text])));
alter table v3.campaigns add constraint campaigns_pkey PRIMARY KEY (id);
alter table v3.campaigns add constraint campaigns_type_check CHECK ((type = ANY (ARRAY['monitorear'::text, 'prospectar'::text, 'descubrir'::text])));
alter table v3.chat_conversations add constraint chat_conversations_pkey PRIMARY KEY (id);
alter table v3.chat_messages add constraint chat_messages_pkey PRIMARY KEY (id);
alter table v3.chat_messages add constraint chat_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text, 'tool'::text])));
alter table v3.client_ai_executions add constraint client_ai_executions_feature_check CHECK ((feature = ANY (ARRAY['account_research'::text, 'icebreaker'::text, 'success_cases'::text, 'company_news'::text])));
alter table v3.client_ai_executions add constraint client_ai_executions_pkey PRIMARY KEY (id);
alter table v3.client_ai_executions add constraint client_ai_executions_principal_chk CHECK ((num_nonnulls(api_key_id, oauth_token_id) = 1));
alter table v3.client_ai_executions add constraint client_ai_executions_status_check CHECK ((status = ANY (ARRAY['prepared'::text, 'in_progress'::text, 'completed'::text, 'rejected'::text, 'expired'::text])));
alter table v3.client_ai_stage_submissions add constraint client_ai_stage_submissions_execution_id_stage_idempotency__key UNIQUE (execution_id, stage, idempotency_key);
alter table v3.client_ai_stage_submissions add constraint client_ai_stage_submissions_pkey PRIMARY KEY (id);
alter table v3.client_ai_stage_submissions add constraint client_ai_stage_submissions_status_check CHECK ((status = ANY (ARRAY['accepted'::text, 'rejected'::text])));
alter table v3.company_dup_candidates add constraint company_dup_candidates_classification_check CHECK ((classification = ANY (ARRAY['seguro'::text, 'ambiguo'::text])));
alter table v3.company_dup_candidates add constraint company_dup_candidates_method_check CHECK ((method = ANY (ARRAY['exact'::text, 'core'::text, 'trgm'::text])));
alter table v3.company_dup_candidates add constraint company_dup_candidates_pkey PRIMARY KEY (id);
alter table v3.company_dup_candidates add constraint company_dup_candidates_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'ai_same'::text, 'ai_different'::text, 'ai_unsure'::text, 'merged'::text, 'dismissed'::text, 'failed'::text])));
alter table v3.company_dup_groups add constraint company_dup_groups_pkey PRIMARY KEY (group_key);
alter table v3.company_merges add constraint company_merges_method_check CHECK ((method = ANY (ARRAY['exact'::text, 'core'::text, 'trgm'::text, 'ai'::text, 'manual'::text])));
alter table v3.company_merges add constraint company_merges_pkey PRIMARY KEY (id);
alter table v3.company_name_index add constraint company_name_index_pkey PRIMARY KEY (company_id);
alter table v3.contact_enrichment_runs add constraint contact_enrichment_runs_pkey PRIMARY KEY (id);
alter table v3.contact_enrichment_runs add constraint contact_enrichment_runs_status_check CHECK ((status = ANY (ARRAY['prepared'::text, 'running'::text, 'completed'::text, 'failed'::text, 'expired'::text])));
alter table v3.conversation_memory add constraint conversation_memory_pkey PRIMARY KEY (conversation_id);
alter table v3.dictionary_job_titles add constraint dictionary_job_titles_pkey PRIMARY KEY (id);
alter table v3.dictionary_term_suggestions add constraint dictionary_term_suggestions_normalized_term_suggested_type_key UNIQUE (normalized_term, suggested_type);
alter table v3.dictionary_term_suggestions add constraint dictionary_term_suggestions_pkey PRIMARY KEY (id);
alter table v3.dictionary_term_suggestions add constraint dictionary_term_suggestions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
alter table v3.dictionary_term_suggestions add constraint dictionary_term_suggestions_suggested_type_check CHECK ((suggested_type = ANY (ARRAY['technology'::text, 'process'::text, 'vendor'::text, 'product'::text])));
alter table v3.digest_log add constraint digest_log_pkey PRIMARY KEY (id);
alter table v3.explore_sessions add constraint explore_sessions_pkey PRIMARY KEY (id);
alter table v3.followed_account_subscribers add constraint followed_account_subscribers_followed_account_id_user_id_key UNIQUE (followed_account_id, user_id);
alter table v3.followed_account_subscribers add constraint followed_account_subscribers_pkey PRIMARY KEY (id);
alter table v3.followed_accounts add constraint followed_accounts_pkey PRIMARY KEY (id);
alter table v3.followed_accounts add constraint followed_accounts_refresh_day_check CHECK (((refresh_day >= 1) AND (refresh_day <= 28)));
alter table v3.followed_accounts add constraint followed_accounts_workspace_id_company_id_key UNIQUE (workspace_id, company_id);
alter table v3.icebreakers add constraint icebreakers_feedback_check CHECK ((feedback = ANY (ARRAY['-1'::integer, 1])));
alter table v3.icebreakers add constraint icebreakers_pkey PRIMARY KEY (id);
alter table v3.linkedin_company_enrichment add constraint linkedin_company_enrichment_hq_source_check CHECK ((hq_source = ANY (ARRAY['headquarter_flag'::text, 'single_location'::text, 'unanimous_country'::text])));
alter table v3.linkedin_company_enrichment add constraint linkedin_company_enrichment_mode_check CHECK ((mode = ANY (ARRAY['companies'::text, 'searches'::text])));
alter table v3.linkedin_company_enrichment add constraint linkedin_company_enrichment_pkey PRIMARY KEY (company_id);
alter table v3.linkedin_company_enrichment add constraint linkedin_company_enrichment_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'no_result'::text, 'no_hq'::text, 'error'::text])));
alter table v3.mcp_api_keys add constraint mcp_api_keys_key_hash_key UNIQUE (key_hash);
alter table v3.mcp_api_keys add constraint mcp_api_keys_pkey PRIMARY KEY (id);
alter table v3.mcp_document_drafts add constraint mcp_document_drafts_pkey PRIMARY KEY (id);
alter table v3.mcp_document_drafts add constraint mcp_document_drafts_source_type_check CHECK ((source_type = ANY (ARRAY['text'::text, 'url'::text, 'upload'::text])));
alter table v3.mcp_document_drafts add constraint mcp_document_drafts_status_check CHECK ((status = ANY (ARRAY['pending_upload'::text, 'processing'::text, 'ready_for_analysis'::text, 'confirmed'::text, 'error'::text, 'expired'::text])));
alter table v3.mcp_document_upload_tokens add constraint mcp_document_upload_tokens_pkey PRIMARY KEY (id);
alter table v3.mcp_document_upload_tokens add constraint mcp_document_upload_tokens_token_hash_key UNIQUE (token_hash);
alter table v3.mcp_oauth_authorization_codes add constraint mcp_oauth_authorization_codes_code_challenge_method_check CHECK ((code_challenge_method = 'S256'::text));
alter table v3.mcp_oauth_authorization_codes add constraint mcp_oauth_authorization_codes_code_hash_key UNIQUE (code_hash);
alter table v3.mcp_oauth_authorization_codes add constraint mcp_oauth_authorization_codes_pkey PRIMARY KEY (id);
alter table v3.mcp_oauth_clients add constraint mcp_oauth_clients_client_id_key UNIQUE (client_id);
alter table v3.mcp_oauth_clients add constraint mcp_oauth_clients_pkey PRIMARY KEY (id);
alter table v3.mcp_oauth_clients add constraint mcp_oauth_clients_token_endpoint_auth_method_check CHECK ((token_endpoint_auth_method = ANY (ARRAY['none'::text, 'client_secret_post'::text])));
alter table v3.mcp_oauth_tokens add constraint mcp_oauth_tokens_pkey PRIMARY KEY (id);
alter table v3.mcp_oauth_tokens add constraint mcp_oauth_tokens_refresh_token_hash_key UNIQUE (refresh_token_hash);
alter table v3.mcp_oauth_tokens add constraint mcp_oauth_tokens_token_hash_key UNIQUE (token_hash);
alter table v3.mcp_request_logs add constraint mcp_request_logs_pkey PRIMARY KEY (id);
alter table v3.mcp_request_logs add constraint mcp_request_logs_principal_chk CHECK ((num_nonnulls(api_key_id, oauth_token_id) = 1));
alter table v3.mcp_usage_reservations add constraint mcp_usage_reservations_pkey PRIMARY KEY (id);
alter table v3.mcp_usage_reservations add constraint mcp_usage_reservations_pool_check CHECK ((pool = ANY (ARRAY['research_server'::text, 'icebreaker_server'::text, 'research_client'::text, 'icebreaker_client'::text, 'apollo_enrichment'::text, 'success_cases_client'::text, 'news_client'::text, 'apify_jobs'::text])));
alter table v3.mcp_usage_reservations add constraint mcp_usage_reservations_principal_chk CHECK ((num_nonnulls(api_key_id, oauth_token_id) = 1));
alter table v3.mcp_usage_reservations add constraint mcp_usage_reservations_status_check CHECK ((status = ANY (ARRAY['reserved'::text, 'committed'::text, 'released'::text])));
alter table v3.mcp_usage_reservations add constraint mcp_usage_reservations_units_check CHECK ((units > 0));
alter table v3.radar_micro_agents add constraint radar_micro_agents_key_key UNIQUE (key);
alter table v3.radar_micro_agents add constraint radar_micro_agents_pkey PRIMARY KEY (id);
alter table v3.research_jobs add constraint research_jobs_phase_check CHECK ((phase = ANY (ARRAY['internal'::text, 'external'::text, 'finalizing'::text])));
alter table v3.research_jobs add constraint research_jobs_pkey PRIMARY KEY (id);
alter table v3.research_jobs add constraint research_jobs_progress_check CHECK (((progress >= 0) AND (progress <= 100)));
alter table v3.research_jobs add constraint research_jobs_resolution_matched_by_check CHECK (((resolution_matched_by IS NULL) OR (resolution_matched_by = ANY (ARRAY['domain'::text, 'alias'::text, 'exact_name'::text, 'ranked'::text]))));
alter table v3.research_jobs add constraint research_jobs_source_check CHECK ((source = ANY (ARRAY['user'::text, 'cron'::text])));
alter table v3.research_jobs add constraint research_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'preliminary_ready'::text, 'completed'::text, 'completed_with_warnings'::text, 'failed'::text, 'failed_retriable'::text, 'failed_terminal'::text, 'cancelled'::text])));
alter table v3.research_stage_runs add constraint research_stage_runs_pkey PRIMARY KEY (id);
alter table v3.research_stage_runs add constraint research_stage_runs_research_job_id_stage_input_hash_key UNIQUE (research_job_id, stage, input_hash);
alter table v3.research_stage_runs add constraint research_stage_runs_stage_check CHECK ((stage = ANY (ARRAY['resolve_company'::text, 'internal_snapshot'::text, 'preliminary_fit'::text, 'external_collect'::text, 'external_classify'::text, 'jobs_interpret'::text, 'contacts'::text, 'final_score'::text, 'final_brief'::text])));
alter table v3.research_stage_runs add constraint research_stage_runs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text, 'skipped'::text, 'cancelled'::text])));
alter table v3.tech_radar_runs add constraint tech_radar_runs_caller_check CHECK ((caller = ANY (ARRAY['drilldown'::text, 'campaign'::text])));
alter table v3.tech_radar_runs add constraint tech_radar_runs_pkey PRIMARY KEY (id);
alter table v3.tech_radar_runs add constraint tech_radar_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])));
alter table v3.workspace_document_tags add constraint workspace_document_tags_pkey PRIMARY KEY (id);
alter table v3.workspace_document_tags add constraint workspace_document_tags_tag_type_check CHECK ((tag_type = ANY (ARRAY['industry'::text, 'technology'::text, 'process'::text])));
alter table v3.workspace_documents add constraint workspace_documents_pkey PRIMARY KEY (id);
alter table v3.workspace_documents add constraint workspace_documents_status_check CHECK ((status = ANY (ARRAY['uploading'::text, 'processing'::text, 'ready'::text, 'error'::text])));
alter table v3.workspace_documents add constraint workspace_documents_type_check CHECK ((type = ANY (ARRAY['pdf'::text, 'pptx'::text, 'docx'::text, 'url'::text])));
alter table v3.workspace_invitations add constraint workspace_invitations_pkey PRIMARY KEY (id);
alter table v3.workspace_invitations add constraint workspace_invitations_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text])));
alter table v3.workspace_invitations add constraint workspace_invitations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'revoked'::text, 'expired'::text])));
alter table v3.workspace_invitations add constraint workspace_invitations_token_key UNIQUE (token);
alter table v3.workspace_members add constraint workspace_members_pkey PRIMARY KEY (id);
alter table v3.workspace_members add constraint workspace_members_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text])));
alter table v3.workspace_members add constraint workspace_members_status_check CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text])));
alter table v3.workspace_members add constraint workspace_members_workspace_id_user_id_key UNIQUE (workspace_id, user_id);
alter table v3.workspace_value_profiles add constraint workspace_value_profiles_pkey PRIMARY KEY (id);
alter table v3.workspace_value_profiles add constraint workspace_value_profiles_workspace_id_key UNIQUE (workspace_id);
alter table v3.workspaces add constraint workspaces_domain_key UNIQUE (domain);
alter table v3.workspaces add constraint workspaces_pkey PRIMARY KEY (id);
alter table v3.workspaces add constraint workspaces_plan_check CHECK ((plan = ANY (ARRAY['trial'::text, 'silver'::text, 'gold'::text, 'platinum'::text])));

-- ============ FOREIGN KEYS ============
alter table public.admin_audit_log add constraint admin_audit_log_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES profiles(id);
alter table public.apollo_search_queries add constraint apollo_search_queries_fetched_by_fkey FOREIGN KEY (fetched_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.apollo_search_results add constraint apollo_search_results_contact_cache_id_fkey FOREIGN KEY (contact_cache_id) REFERENCES apollo_contacts_cache(id) ON DELETE CASCADE;
alter table public.apollo_search_results add constraint apollo_search_results_query_id_fkey FOREIGN KEY (query_id) REFERENCES apollo_search_queries(id) ON DELETE CASCADE;
alter table public.bookmark_summaries add constraint bookmark_summaries_bookmark_id_fkey FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE;
alter table public.bookmarks add constraint bookmarks_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.bookmarks add constraint bookmarks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.companies add constraint companies_master_industry_id_fkey FOREIGN KEY (master_industry_id) REFERENCES master_industries(id);
alter table public.company_implementations add constraint company_implementations_bookmark_id_fkey FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE SET NULL;
alter table public.company_implementations add constraint company_implementations_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.company_implementations add constraint company_implementations_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id);
alter table public.company_implementations add constraint company_implementations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.company_news add constraint company_news_bookmark_id_fkey FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE SET NULL;
alter table public.company_news add constraint company_news_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.company_news add constraint company_news_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id);
alter table public.company_news add constraint company_news_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.company_public_docs add constraint company_public_docs_bookmark_id_fkey FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE SET NULL;
alter table public.company_public_docs add constraint company_public_docs_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.company_public_docs add constraint company_public_docs_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id);
alter table public.company_public_docs add constraint company_public_docs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.contacts add constraint contacts_current_company_id_fkey FOREIGN KEY (current_company_id) REFERENCES companies(id);
alter table public.dictionary_products add constraint dictionary_products_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES dictionary_vendors(id) ON DELETE CASCADE;
alter table public.digest_send_log add constraint digest_send_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.document_tags add constraint document_tags_document_id_fkey FOREIGN KEY (document_id) REFERENCES user_documents(id) ON DELETE CASCADE;
alter table public.document_tags add constraint document_tags_master_industry_id_fkey FOREIGN KEY (master_industry_id) REFERENCES master_industries(id);
alter table public.document_tags add constraint document_tags_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.icebreaker_templates add constraint icebreaker_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.import_batches add constraint import_batches_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.import_rows add constraint import_rows_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE CASCADE;
alter table public.industry_mappings add constraint industry_mappings_mapped_by_fkey FOREIGN KEY (mapped_by) REFERENCES auth.users(id);
alter table public.industry_mappings add constraint industry_mappings_master_industry_id_fkey FOREIGN KEY (master_industry_id) REFERENCES master_industries(id) ON DELETE SET NULL;
alter table public.ingestion_logs add constraint ingestion_logs_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES profiles(id);
alter table public.job_postings add constraint job_postings_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public.pending_signals add constraint pending_signals_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE;
alter table public.pending_signals add constraint pending_signals_job_id_fkey FOREIGN KEY (job_id) REFERENCES job_postings(id) ON DELETE CASCADE;
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.radar_findings add constraint radar_findings_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public.radar_findings add constraint radar_findings_run_id_fkey FOREIGN KEY (run_id) REFERENCES radar_research_runs(id) ON DELETE SET NULL;
alter table public.radar_research_runs add constraint radar_research_runs_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public.resend_audiences add constraint resend_audiences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.signals add constraint signals_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public.signals add constraint signals_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE;
alter table public.signals add constraint signals_job_posting_id_fkey FOREIGN KEY (job_posting_id) REFERENCES job_postings(id) ON DELETE CASCADE;
alter table public.success_cases add constraint success_cases_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.user_company_contacts add constraint user_company_contacts_apollo_cache_id_fkey FOREIGN KEY (apollo_cache_id) REFERENCES apollo_contacts_cache(id);
alter table public.user_company_contacts add constraint user_company_contacts_bookmark_id_fkey FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE SET NULL;
alter table public.user_company_contacts add constraint user_company_contacts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public.user_company_contacts add constraint user_company_contacts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.user_company_signals add constraint user_company_signals_bookmark_id_fkey FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE;
alter table public.user_company_signals add constraint user_company_signals_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public.user_company_signals add constraint user_company_signals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.user_company_strategies add constraint user_company_strategies_bookmark_id_fkey FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE;
alter table public.user_company_strategies add constraint user_company_strategies_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.user_company_strategies add constraint user_company_strategies_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.user_digest_sent_items add constraint user_digest_sent_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.user_documents add constraint user_documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.user_icebreakers add constraint user_icebreakers_bookmark_id_fkey FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE;
alter table public.user_icebreakers add constraint user_icebreakers_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public.user_icebreakers add constraint user_icebreakers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.user_implementation_interactions add constraint user_implementation_interactions_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.user_implementation_interactions add constraint user_implementation_interactions_implementation_id_fkey FOREIGN KEY (implementation_id) REFERENCES company_implementations(id) ON DELETE CASCADE;
alter table public.user_implementation_interactions add constraint user_implementation_interactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.user_news_interactions add constraint user_news_interactions_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.user_news_interactions add constraint user_news_interactions_news_id_fkey FOREIGN KEY (news_id) REFERENCES company_news(id) ON DELETE CASCADE;
alter table public.user_news_interactions add constraint user_news_interactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.user_notification_preferences add constraint user_notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.user_onboarding add constraint user_onboarding_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.user_public_doc_interactions add constraint user_public_doc_interactions_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.user_public_doc_interactions add constraint user_public_doc_interactions_public_doc_id_fkey FOREIGN KEY (public_doc_id) REFERENCES company_public_docs(id) ON DELETE CASCADE;
alter table public.user_public_doc_interactions add constraint user_public_doc_interactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.user_value_profiles add constraint user_value_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table v3.account_briefs add constraint account_briefs_client_execution_id_fkey FOREIGN KEY (client_execution_id) REFERENCES v3.client_ai_executions(id);
alter table v3.account_briefs add constraint account_briefs_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
alter table v3.account_briefs add constraint account_briefs_research_job_id_fkey FOREIGN KEY (research_job_id) REFERENCES v3.research_jobs(id) ON DELETE SET NULL;
alter table v3.account_briefs add constraint account_briefs_scorecard_id_fkey FOREIGN KEY (scorecard_id) REFERENCES v3.account_scorecards(id) ON DELETE SET NULL;
alter table v3.account_briefs add constraint account_briefs_supersedes_brief_id_fkey FOREIGN KEY (supersedes_brief_id) REFERENCES v3.account_briefs(id) ON DELETE SET NULL;
alter table v3.account_briefs add constraint account_briefs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE CASCADE;
alter table v3.account_contacts add constraint account_contacts_apollo_cache_id_fkey FOREIGN KEY (apollo_cache_id) REFERENCES apollo_contacts_cache(id) ON DELETE SET NULL;
alter table v3.account_contacts add constraint account_contacts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table v3.account_contacts add constraint account_contacts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE CASCADE;
alter table v3.account_evidence_details add constraint account_evidence_details_execution_id_fkey FOREIGN KEY (execution_id) REFERENCES v3.client_ai_executions(id) ON DELETE CASCADE;
alter table v3.account_internal_snapshots add constraint account_internal_snapshots_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
alter table v3.account_internal_snapshots add constraint account_internal_snapshots_research_job_id_fkey FOREIGN KEY (research_job_id) REFERENCES v3.research_jobs(id) ON DELETE SET NULL;
alter table v3.account_internal_snapshots add constraint account_internal_snapshots_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE CASCADE;
alter table v3.account_scorecards add constraint account_scorecards_client_execution_id_fkey FOREIGN KEY (client_execution_id) REFERENCES v3.client_ai_executions(id);
alter table v3.account_scorecards add constraint account_scorecards_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
alter table v3.account_scorecards add constraint account_scorecards_research_job_id_fkey FOREIGN KEY (research_job_id) REFERENCES v3.research_jobs(id) ON DELETE SET NULL;
alter table v3.account_scorecards add constraint account_scorecards_supersedes_scorecard_id_fkey FOREIGN KEY (supersedes_scorecard_id) REFERENCES v3.account_scorecards(id) ON DELETE SET NULL;
alter table v3.account_scorecards add constraint account_scorecards_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE CASCADE;
alter table v3.ai_prompt_versions add constraint ai_prompt_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table v3.ai_prompts add constraint ai_prompts_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table v3.ai_usage_log add constraint ai_usage_log_api_key_id_fkey FOREIGN KEY (api_key_id) REFERENCES v3.mcp_api_keys(id);
alter table v3.ai_usage_log add constraint ai_usage_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
alter table v3.ai_usage_log add constraint ai_usage_log_research_job_id_fkey FOREIGN KEY (research_job_id) REFERENCES v3.research_jobs(id);
alter table v3.ai_usage_log add constraint ai_usage_log_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE SET NULL;
alter table v3.buyer_personas add constraint buyer_personas_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE CASCADE;
alter table v3.campaign_account_digest add constraint campaign_account_digest_buyer_persona_id_fkey FOREIGN KEY (buyer_persona_id) REFERENCES v3.buyer_personas(id);
alter table v3.campaign_account_digest add constraint campaign_account_digest_campaign_account_id_fkey FOREIGN KEY (campaign_account_id) REFERENCES v3.campaign_accounts(id) ON DELETE CASCADE;
alter table v3.campaign_accounts add constraint campaign_accounts_added_by_fkey FOREIGN KEY (added_by) REFERENCES auth.users(id);
alter table v3.campaign_accounts add constraint campaign_accounts_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES v3.campaigns(id) ON DELETE CASCADE;
alter table v3.campaigns add constraint campaigns_buyer_persona_id_fkey FOREIGN KEY (buyer_persona_id) REFERENCES v3.buyer_personas(id);
alter table v3.campaigns add constraint campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table v3.campaigns add constraint campaigns_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE CASCADE;
alter table v3.chat_conversations add constraint chat_conversations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE CASCADE;
alter table v3.chat_messages add constraint chat_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES v3.chat_conversations(id) ON DELETE CASCADE;
alter table v3.client_ai_executions add constraint client_ai_executions_api_key_id_fkey FOREIGN KEY (api_key_id) REFERENCES v3.mcp_api_keys(id);
alter table v3.client_ai_executions add constraint client_ai_executions_oauth_token_id_fkey FOREIGN KEY (oauth_token_id) REFERENCES v3.mcp_oauth_tokens(id) ON DELETE SET NULL;
alter table v3.client_ai_executions add constraint client_ai_executions_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES v3.mcp_usage_reservations(id);
alter table v3.client_ai_executions add constraint client_ai_executions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table v3.client_ai_stage_submissions add constraint client_ai_stage_submissions_execution_id_fkey FOREIGN KEY (execution_id) REFERENCES v3.client_ai_executions(id) ON DELETE CASCADE;
alter table v3.contact_enrichment_runs add constraint contact_enrichment_runs_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table v3.contact_enrichment_runs add constraint contact_enrichment_runs_oauth_token_id_fkey FOREIGN KEY (oauth_token_id) REFERENCES v3.mcp_oauth_tokens(id) ON DELETE SET NULL;
alter table v3.contact_enrichment_runs add constraint contact_enrichment_runs_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES v3.mcp_usage_reservations(id) ON DELETE SET NULL;
alter table v3.contact_enrichment_runs add constraint contact_enrichment_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE CASCADE;
alter table v3.conversation_memory add constraint conversation_memory_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES v3.chat_conversations(id) ON DELETE CASCADE;
alter table v3.conversation_memory add constraint conversation_memory_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE CASCADE;
alter table v3.digest_log add constraint digest_log_followed_account_id_fkey FOREIGN KEY (followed_account_id) REFERENCES v3.followed_accounts(id) ON DELETE CASCADE;
alter table v3.digest_log add constraint digest_log_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE CASCADE;
alter table v3.followed_account_subscribers add constraint followed_account_subscribers_followed_account_id_fkey FOREIGN KEY (followed_account_id) REFERENCES v3.followed_accounts(id) ON DELETE CASCADE;
alter table v3.followed_account_subscribers add constraint followed_account_subscribers_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE CASCADE;
alter table v3.followed_accounts add constraint followed_accounts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
alter table v3.followed_accounts add constraint followed_accounts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE CASCADE;
alter table v3.icebreakers add constraint icebreakers_client_execution_id_fkey FOREIGN KEY (client_execution_id) REFERENCES v3.client_ai_executions(id);
alter table v3.icebreakers add constraint icebreakers_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
alter table v3.icebreakers add constraint icebreakers_regenerated_from_fkey FOREIGN KEY (regenerated_from) REFERENCES v3.icebreakers(id) ON DELETE SET NULL;
alter table v3.icebreakers add constraint icebreakers_research_job_id_fkey FOREIGN KEY (research_job_id) REFERENCES v3.research_jobs(id) ON DELETE SET NULL;
alter table v3.icebreakers add constraint icebreakers_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE CASCADE;
alter table v3.linkedin_company_enrichment add constraint linkedin_company_enrichment_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table v3.mcp_api_keys add constraint mcp_api_keys_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table v3.mcp_api_keys add constraint mcp_api_keys_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id);
alter table v3.mcp_api_keys add constraint mcp_api_keys_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE CASCADE;
alter table v3.mcp_document_drafts add constraint mcp_document_drafts_confirmed_document_id_fkey FOREIGN KEY (confirmed_document_id) REFERENCES v3.workspace_documents(id) ON DELETE SET NULL;
alter table v3.mcp_document_drafts add constraint mcp_document_drafts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table v3.mcp_document_drafts add constraint mcp_document_drafts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE CASCADE;
alter table v3.mcp_document_upload_tokens add constraint mcp_document_upload_tokens_draft_id_fkey FOREIGN KEY (draft_id) REFERENCES v3.mcp_document_drafts(id) ON DELETE CASCADE;
alter table v3.mcp_document_upload_tokens add constraint mcp_document_upload_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table v3.mcp_document_upload_tokens add constraint mcp_document_upload_tokens_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE CASCADE;
alter table v3.mcp_oauth_authorization_codes add constraint mcp_oauth_authorization_codes_client_id_fkey FOREIGN KEY (client_id) REFERENCES v3.mcp_oauth_clients(client_id) ON DELETE CASCADE;
alter table v3.mcp_oauth_authorization_codes add constraint mcp_oauth_authorization_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table v3.mcp_oauth_authorization_codes add constraint mcp_oauth_authorization_codes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE CASCADE;
alter table v3.mcp_oauth_tokens add constraint mcp_oauth_tokens_client_id_fkey FOREIGN KEY (client_id) REFERENCES v3.mcp_oauth_clients(client_id) ON DELETE CASCADE;
alter table v3.mcp_oauth_tokens add constraint mcp_oauth_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table v3.mcp_oauth_tokens add constraint mcp_oauth_tokens_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE CASCADE;
alter table v3.mcp_request_logs add constraint mcp_request_logs_api_key_id_fkey FOREIGN KEY (api_key_id) REFERENCES v3.mcp_api_keys(id) ON DELETE CASCADE;
alter table v3.mcp_request_logs add constraint mcp_request_logs_oauth_token_id_fkey FOREIGN KEY (oauth_token_id) REFERENCES v3.mcp_oauth_tokens(id) ON DELETE SET NULL;
alter table v3.mcp_usage_reservations add constraint mcp_usage_reservations_api_key_id_fkey FOREIGN KEY (api_key_id) REFERENCES v3.mcp_api_keys(id);
alter table v3.mcp_usage_reservations add constraint mcp_usage_reservations_oauth_token_id_fkey FOREIGN KEY (oauth_token_id) REFERENCES v3.mcp_oauth_tokens(id) ON DELETE SET NULL;
alter table v3.mcp_usage_reservations add constraint mcp_usage_reservations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table v3.research_jobs add constraint research_jobs_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
alter table v3.research_jobs add constraint research_jobs_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES v3.chat_conversations(id) ON DELETE SET NULL;
alter table v3.research_jobs add constraint research_jobs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE CASCADE;
alter table v3.research_stage_runs add constraint research_stage_runs_research_job_id_fkey FOREIGN KEY (research_job_id) REFERENCES v3.research_jobs(id) ON DELETE CASCADE;
alter table v3.research_stage_runs add constraint research_stage_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE CASCADE;
alter table v3.tech_radar_runs add constraint tech_radar_runs_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
alter table v3.workspace_document_tags add constraint workspace_document_tags_document_id_fkey FOREIGN KEY (document_id) REFERENCES v3.workspace_documents(id) ON DELETE CASCADE;
alter table v3.workspace_document_tags add constraint workspace_document_tags_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE CASCADE;
alter table v3.workspace_documents add constraint workspace_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id);
alter table v3.workspace_documents add constraint workspace_documents_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE CASCADE;
alter table v3.workspace_invitations add constraint workspace_invitations_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES auth.users(id);
alter table v3.workspace_invitations add constraint workspace_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id);
alter table v3.workspace_invitations add constraint workspace_invitations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE CASCADE;
alter table v3.workspace_members add constraint workspace_members_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id);
alter table v3.workspace_members add constraint workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table v3.workspace_members add constraint workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE CASCADE;
alter table v3.workspace_value_profiles add constraint workspace_value_profiles_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES v3.workspaces(id) ON DELETE CASCADE;
alter table v3.workspaces add constraint workspaces_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

-- ============ INDEXES ============
CREATE INDEX IF NOT EXISTS account_contacts_request_idx ON v3.account_contacts USING btree (apollo_request_id) WHERE (apollo_request_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS account_contacts_ws_company_idx ON v3.account_contacts USING btree (workspace_id, company_id);
CREATE UNIQUE INDEX IF NOT EXISTS account_contacts_ws_company_person_uniq ON v3.account_contacts USING btree (workspace_id, company_id, apollo_person_id);
CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_user_company_context_uniq ON public.bookmarks USING btree (user_id, company_id, v3.bookmark_context_key(search_context)) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS company_dup_groups_pendientes_idx ON v3.company_dup_groups USING btree (peso DESC, n DESC) WHERE (promoted_at IS NULL);
CREATE INDEX IF NOT EXISTS company_name_index_core_idx ON v3.company_name_index USING btree (core) WHERE ((core IS NOT NULL) AND (length(core) >= 3));
CREATE INDEX IF NOT EXISTS company_name_index_weight_idx ON v3.company_name_index USING btree (weight DESC);
CREATE INDEX IF NOT EXISTS contact_enrichment_runs_company_idx ON v3.contact_enrichment_runs USING btree (workspace_id, company_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS contact_enrichment_runs_idem_key ON v3.contact_enrichment_runs USING btree (workspace_id, idempotency_key);
CREATE INDEX IF NOT EXISTS contact_enrichment_runs_status_idx ON v3.contact_enrichment_runs USING btree (status, expires_at) WHERE (status = ANY (ARRAY['prepared'::text, 'running'::text]));
CREATE UNIQUE INDEX IF NOT EXISTS dictionary_job_titles_process_title_key ON v3.dictionary_job_titles USING btree (process_id, job_title) WHERE (process_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS explore_sessions_ws_idx ON v3.explore_sessions USING btree (workspace_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_briefs_company_id ON v3.account_briefs USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_account_contacts_company_id ON v3.account_contacts USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_account_evidence_details_execution ON v3.account_evidence_details USING btree (execution_id);
CREATE INDEX IF NOT EXISTS idx_account_evidence_details_lookup ON v3.account_evidence_details USING btree (workspace_id, company_id, term_id);
CREATE INDEX IF NOT EXISTS idx_account_internal_snapshots_company_id ON v3.account_internal_snapshots USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_account_scorecards_company_id ON v3.account_scorecards USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_ai_prompt_versions_key ON v3.ai_prompt_versions USING btree (prompt_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_company_id ON v3.ai_usage_log USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_apollo_api_calls_company ON public.apollo_api_calls USING btree (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_apollo_api_calls_endpoint_created ON public.apollo_api_calls USING btree (endpoint, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_apollo_api_calls_errors ON public.apollo_api_calls USING btree (created_at DESC) WHERE ((error IS NOT NULL) OR (response_status >= 400));
CREATE INDEX IF NOT EXISTS idx_apollo_api_calls_query_hash ON public.apollo_api_calls USING btree (query_hash) WHERE (query_hash IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_apollo_api_calls_user_created ON public.apollo_api_calls USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_apollo_cache_apollo_id ON public.apollo_contacts_cache USING btree (apollo_id);
CREATE INDEX IF NOT EXISTS idx_apollo_cache_domain ON public.apollo_contacts_cache USING btree (company_domain);
CREATE INDEX IF NOT EXISTS idx_apollo_cache_linkedin ON public.apollo_contacts_cache USING btree (company_linkedin_url);
CREATE INDEX IF NOT EXISTS idx_apollo_search_queries_expires ON public.apollo_search_queries USING btree (expires_at);
CREATE INDEX IF NOT EXISTS idx_apollo_search_queries_hash ON public.apollo_search_queries USING btree (query_hash);
CREATE INDEX IF NOT EXISTS idx_apollo_search_queries_org ON public.apollo_search_queries USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_apollo_search_results_contact ON public.apollo_search_results USING btree (contact_cache_id);
CREATE INDEX IF NOT EXISTS idx_apollo_search_results_query ON public.apollo_search_results USING btree (query_id);
CREATE INDEX IF NOT EXISTS idx_apollo_title_catalog_aliases ON public.apollo_title_catalog USING gin (aliases);
CREATE INDEX IF NOT EXISTS idx_apollo_title_catalog_dept ON public.apollo_title_catalog USING btree (department) WHERE (department IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_apollo_title_catalog_seniority ON public.apollo_title_catalog USING btree (seniority) WHERE (seniority IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_apollo_title_catalog_success ON public.apollo_title_catalog USING btree (success_count DESC, usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_apollo_title_catalog_trgm ON public.apollo_title_catalog USING gin (display_title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON public.admin_audit_log USING btree (action);
CREATE INDEX IF NOT EXISTS idx_audit_log_admin ON public.admin_audit_log USING btree (admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_date ON public.admin_audit_log USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON public.admin_audit_log USING btree (target_user_id);
CREATE INDEX IF NOT EXISTS idx_bookmark_dedupe_log_batch ON v3.bookmark_dedupe_log USING btree (batch_id);
CREATE INDEX IF NOT EXISTS idx_bookmark_summaries_bookmark_id ON public.bookmark_summaries USING btree (bookmark_id);
CREATE INDEX IF NOT EXISTS idx_bookmark_summaries_context_hash ON public.bookmark_summaries USING btree (context_hash);
CREATE INDEX IF NOT EXISTS idx_bookmarks_company_id ON public.bookmarks USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_status ON public.bookmarks USING btree (status);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_id ON public.bookmarks USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_status ON public.bookmarks USING btree (user_id, status);
CREATE INDEX IF NOT EXISTS idx_client_ai_executions_workspace ON v3.client_ai_executions USING btree (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_ai_submissions_execution ON v3.client_ai_stage_submissions USING btree (execution_id, created_at);
CREATE INDEX IF NOT EXISTS idx_companies_apollo_org_id ON public.companies USING btree (apollo_organization_id) WHERE (apollo_organization_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_companies_apollo_org_status ON public.companies USING btree (apollo_org_status, apollo_org_synced_at) WHERE (apollo_org_status = ANY (ARRAY['not_found'::text, 'error'::text]));
CREATE INDEX IF NOT EXISTS idx_companies_cik ON public.companies USING btree (cik);
CREATE INDEX IF NOT EXISTS idx_companies_country ON public.companies USING btree (country);
CREATE INDEX IF NOT EXISTS idx_companies_country_normalized ON public.companies USING btree (country_normalized);
CREATE INDEX IF NOT EXISTS idx_companies_hq_country_iso ON public.companies USING btree (hq_country_iso) WHERE (hq_country_iso IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_companies_is_public ON public.companies USING btree (is_public);
CREATE INDEX IF NOT EXISTS idx_companies_linkedin_slug ON public.companies USING btree (linkedin_slug);
CREATE INDEX IF NOT EXISTS idx_companies_lower_name ON public.companies USING btree (lower(COALESCE(name, ''::text)));
CREATE INDEX IF NOT EXISTS idx_companies_lower_normalized_name ON public.companies USING btree (lower(COALESCE(normalized_name, ''::text)));
CREATE INDEX IF NOT EXISTS idx_companies_master_industry ON public.companies USING btree (master_industry_id) WHERE (master_industry_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_companies_name_trgm ON public.companies USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_companies_normalized_name ON public.companies USING btree (normalized_name);
CREATE INDEX IF NOT EXISTS idx_companies_ticker ON public.companies USING btree (ticker);
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_impl_unique_source ON public.company_implementations USING btree (company_id, source_url) WHERE (source_url IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_company_implementations_bookmark_id ON public.company_implementations USING btree (bookmark_id);
CREATE INDEX IF NOT EXISTS idx_company_implementations_company_id ON public.company_implementations USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_company_implementations_published_at ON public.company_implementations USING btree (published_at);
CREATE INDEX IF NOT EXISTS idx_company_implementations_requested_by ON public.company_implementations USING btree (requested_by);
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_implementations_unique_source ON public.company_implementations USING btree (company_id, source_url);
CREATE INDEX IF NOT EXISTS idx_company_implementations_user_id ON public.company_implementations USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_company_merges_master ON v3.company_merges USING btree (master_id);
CREATE INDEX IF NOT EXISTS idx_company_merges_pending ON v3.company_merges USING btree (created_at DESC) WHERE (reverted_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_company_news_bookmark_id ON public.company_news USING btree (bookmark_id);
CREATE INDEX IF NOT EXISTS idx_company_news_company_direction ON public.company_news USING btree (company_id, direction, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_news_company_id ON public.company_news USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_company_news_published_at ON public.company_news USING btree (published_at);
CREATE INDEX IF NOT EXISTS idx_company_news_requested_by ON public.company_news USING btree (requested_by);
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_news_unique_source ON public.company_news USING btree (company_id, source_url) WHERE (source_url IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_company_news_user_id ON public.company_news USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_company_public_docs_tech_snippets ON public.company_public_docs USING gin (tech_snippets);
CREATE INDEX IF NOT EXISTS idx_contact_enrichment_runs_company_id ON v3.contact_enrichment_runs USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_about_trgm ON public.contacts USING gin (about gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contacts_country_normalized ON public.contacts USING btree (country_normalized);
CREATE INDEX IF NOT EXISTS idx_contacts_curdesc_trgm ON public.contacts USING gin (current_position_description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contacts_current_company_id ON public.contacts USING btree (current_company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_curtitle_trgm ON public.contacts USING gin (current_position_title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contacts_headline_trgm ON public.contacts USING gin (headline gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contacts_prevpos_trgm ON public.contacts USING gin (contacts_prevpos_text(previous_positions) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_country_mappings_raw_value ON public.country_mappings USING btree (raw_value);
CREATE INDEX IF NOT EXISTS idx_cron_executions_name ON public.cron_executions USING btree (cron_name);
CREATE INDEX IF NOT EXISTS idx_cron_executions_name_started ON public.cron_executions USING btree (cron_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_executions_started ON public.cron_executions USING btree (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_dictionary_jobs_created_at ON public.dictionary_jobs USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dictionary_jobs_status ON public.dictionary_jobs USING btree (status) WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text]));
CREATE INDEX IF NOT EXISTS idx_digest_send_log_user ON public.digest_send_log USING btree (user_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_document_tags_document_id ON public.document_tags USING btree (document_id);
CREATE INDEX IF NOT EXISTS idx_document_tags_master_industry ON public.document_tags USING btree (master_industry_id) WHERE ((tag_type = 'industry'::tag_type) AND (master_industry_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_document_tags_type ON public.document_tags USING btree (tag_type);
CREATE INDEX IF NOT EXISTS idx_document_tags_user_id ON public.document_tags USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_document_tags_value ON public.document_tags USING btree (tag_value);
CREATE INDEX IF NOT EXISTS idx_dup_candidates_triage ON v3.company_dup_candidates USING btree (classification, status);
CREATE INDEX IF NOT EXISTS idx_followed_accounts_refresh_due ON v3.followed_accounts USING btree (refresh_day, last_refresh_attempt_at) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_health_logs_created_at ON public.system_health_logs USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_logs_status ON public.system_health_logs USING btree (status);
CREATE INDEX IF NOT EXISTS idx_icebreaker_templates_active ON public.icebreaker_templates USING btree (is_active);
CREATE INDEX IF NOT EXISTS idx_icebreaker_templates_tone ON public.icebreaker_templates USING btree (tone);
CREATE INDEX IF NOT EXISTS idx_icebreakers_company_id ON v3.icebreakers USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_impl_company_context ON public.company_implementations USING btree (company_id, search_context, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_impl_company_evidence ON public.company_implementations USING btree (company_id, evidence_level);
CREATE INDEX IF NOT EXISTS idx_impl_company_micro_agent ON public.company_implementations USING btree (company_id, micro_agent);
CREATE INDEX IF NOT EXISTS idx_impl_company_prompt_version ON public.company_implementations USING btree (company_id, prompt_version);
CREATE INDEX IF NOT EXISTS idx_import_batches_status_created ON public.import_batches USING btree (status, created_at) WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text]));
CREATE INDEX IF NOT EXISTS idx_import_batches_user_id ON public.import_batches USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_import_rows_batch_id ON public.import_rows USING btree (batch_id);
CREATE INDEX IF NOT EXISTS idx_import_rows_status ON public.import_rows USING btree (status);
CREATE INDEX IF NOT EXISTS idx_industry_mappings_lookup ON public.industry_mappings USING btree (lower(original_value), source_type);
CREATE INDEX IF NOT EXISTS idx_industry_mappings_master ON public.industry_mappings USING btree (master_industry_id);
CREATE INDEX IF NOT EXISTS idx_industry_mappings_unmapped ON public.industry_mappings USING btree (source_type) WHERE (master_industry_id IS NULL);
CREATE INDEX IF NOT EXISTS idx_job_postings_company_active ON public.job_postings USING btree (company_id, is_active) WHERE (is_active = true);
CREATE INDEX IF NOT EXISTS idx_job_postings_company_id ON public.job_postings USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_job_postings_posted_at ON public.job_postings USING btree (posted_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_jobpostings_desc_trgm ON public.job_postings USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_jobpostings_title_trgm ON public.job_postings USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_lce_retry ON v3.linkedin_company_enrichment USING btree (status, next_attempt_at) WHERE (status = 'error'::text);
CREATE INDEX IF NOT EXISTS idx_li_enrich_processed_at ON v3.linkedin_company_enrichment USING btree (processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_li_enrich_status ON v3.linkedin_company_enrichment USING btree (status);
CREATE INDEX IF NOT EXISTS idx_master_industries_order ON public.master_industries USING btree (display_order);
CREATE INDEX IF NOT EXISTS idx_mcp_reservations_user_pool_time ON v3.mcp_usage_reservations USING btree (user_id, pool, created_at DESC) WHERE (status <> 'released'::text);
CREATE INDEX IF NOT EXISTS idx_mcp_reservations_workspace_pool_time ON v3.mcp_usage_reservations USING btree (workspace_id, pool, created_at DESC) WHERE (status <> 'released'::text);
CREATE INDEX IF NOT EXISTS idx_news_company_created ON public.company_news USING btree (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_patterns_cache_type ON public.dictionary_patterns_cache USING btree (dict_type);
CREATE INDEX IF NOT EXISTS idx_pending_signals_processed ON public.pending_signals USING btree (processed_at, signal_type) WHERE (processed_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_profiles_scheduled_deletion ON public.profiles USING btree (scheduled_deletion_at) WHERE (scheduled_deletion_at IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_public_doc_interactions_company ON public.user_public_doc_interactions USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_public_doc_interactions_doc ON public.user_public_doc_interactions USING btree (public_doc_id);
CREATE INDEX IF NOT EXISTS idx_public_doc_interactions_user ON public.user_public_doc_interactions USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_public_docs_bookmark ON public.company_public_docs USING btree (bookmark_id);
CREATE INDEX IF NOT EXISTS idx_public_docs_company ON public.company_public_docs USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_public_docs_requested_at ON public.company_public_docs USING btree (requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_docs_tech_signals ON public.company_public_docs USING gin (tech_signals);
CREATE INDEX IF NOT EXISTS idx_public_docs_ticker ON public.company_public_docs USING btree (ticker);
CREATE INDEX IF NOT EXISTS idx_public_docs_type ON public.company_public_docs USING btree (document_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_public_docs_unique ON public.company_public_docs USING btree (company_id, document_type, source_url);
CREATE INDEX IF NOT EXISTS idx_public_docs_user ON public.company_public_docs USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_radar_findings_company ON public.radar_findings USING btree (company_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_radar_findings_company_micro_agent ON public.radar_findings USING btree (company_id, micro_agent);
CREATE INDEX IF NOT EXISTS idx_radar_findings_products ON public.radar_findings USING gin (dictionary_product_ids);
CREATE INDEX IF NOT EXISTS idx_radar_runs_company ON public.radar_research_runs USING btree (company_id, radar_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_jobs_company_id ON v3.research_jobs USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_resend_audiences_email ON public.resend_audiences USING btree (email);
CREATE INDEX IF NOT EXISTS idx_resend_audiences_sync_status ON public.resend_audiences USING btree (sync_status);
CREATE INDEX IF NOT EXISTS idx_resend_audiences_user_id ON public.resend_audiences USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_signals_company_id ON public.signals USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_signals_contact_id ON public.signals USING btree (contact_id);
CREATE INDEX IF NOT EXISTS idx_signals_is_current_employee ON public.signals USING btree (company_id, is_current_employee);
CREATE INDEX IF NOT EXISTS idx_signals_job_posted_at ON public.signals USING btree (job_posted_at) WHERE (job_posting_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_signals_signal_id ON public.signals USING btree (signal_id);
CREATE INDEX IF NOT EXISTS idx_signals_signal_type ON public.signals USING btree (signal_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_unique_contact ON public.signals USING btree (signal_id, contact_id, company_id) WHERE (contact_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_success_cases_industry ON public.success_cases USING btree (client_industry);
CREATE INDEX IF NOT EXISTS idx_success_cases_technologies ON public.success_cases USING gin (technologies);
CREATE INDEX IF NOT EXISTS idx_success_cases_user_id ON public.success_cases USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_tech_radar_runs_company ON v3.tech_radar_runs USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_tech_radar_runs_started_at ON v3.tech_radar_runs USING btree (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_tech_radar_runs_status ON v3.tech_radar_runs USING btree (status);
CREATE INDEX IF NOT EXISTS idx_tech_radar_runs_workspace ON v3.tech_radar_runs USING btree (workspace_id);
CREATE INDEX IF NOT EXISTS idx_ucc_apollo_request_id ON public.user_company_contacts USING btree (apollo_request_id) WHERE (apollo_request_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ucc_phone_status_pending ON public.user_company_contacts USING btree (bookmark_id) WHERE (phone_status = 'pending'::text);
CREATE INDEX IF NOT EXISTS idx_user_company_contacts_apollo ON public.user_company_contacts USING btree (user_id, company_id, apollo_person_id) WHERE (apollo_person_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_user_company_contacts_apollo_global ON public.user_company_contacts USING btree (apollo_person_id) WHERE (apollo_person_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_user_company_contacts_apollo_person_id ON public.user_company_contacts USING btree (apollo_person_id) WHERE (apollo_person_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_user_company_contacts_company_id ON public.user_company_contacts USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_user_company_contacts_last_verified ON public.user_company_contacts USING btree (last_verified_at) WHERE (apollo_person_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_user_company_contacts_linkedin_url ON public.user_company_contacts USING btree (linkedin_url) WHERE (linkedin_url IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_user_company_contacts_needs_review ON public.user_company_contacts USING btree (needs_review) WHERE (needs_review = true);
CREATE INDEX IF NOT EXISTS idx_user_company_contacts_phone_pending ON public.user_company_contacts USING btree (phone_requested_at) WHERE (phone_status = 'pending'::text);
CREATE INDEX IF NOT EXISTS idx_user_company_contacts_user_company ON public.user_company_contacts USING btree (user_id, company_id);
CREATE INDEX IF NOT EXISTS idx_user_company_signals_company_id ON public.user_company_signals USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_user_company_signals_user_company ON public.user_company_signals USING btree (user_id, company_id);
CREATE INDEX IF NOT EXISTS idx_user_company_strategies_company_id ON public.user_company_strategies USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_user_contacts_dm ON public.user_company_contacts USING btree (user_id, company_id, is_decision_maker) WHERE (is_decision_maker = true);
CREATE INDEX IF NOT EXISTS idx_user_digest_sent_items_user ON public.user_digest_sent_items USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_user_documents_status ON public.user_documents USING btree (status);
CREATE INDEX IF NOT EXISTS idx_user_documents_user_id ON public.user_documents USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_user_icebreakers_company_id ON public.user_icebreakers USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_user_icebreakers_message_type ON public.user_icebreakers USING btree (message_type);
CREATE INDEX IF NOT EXISTS idx_user_icebreakers_user_company ON public.user_icebreakers USING btree (user_id, company_id);
CREATE INDEX IF NOT EXISTS idx_user_impl_interactions_company_id ON public.user_implementation_interactions USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_user_impl_interactions_impl_id ON public.user_implementation_interactions USING btree (implementation_id);
CREATE INDEX IF NOT EXISTS idx_user_impl_interactions_notified ON public.user_implementation_interactions USING btree (notified_at) WHERE (notified_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_user_impl_interactions_user_id ON public.user_implementation_interactions USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_user_news_interactions_company_id ON public.user_news_interactions USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_user_news_interactions_news_id ON public.user_news_interactions USING btree (news_id);
CREATE INDEX IF NOT EXISTS idx_user_news_interactions_notified ON public.user_news_interactions USING btree (notified_at) WHERE (notified_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_user_news_interactions_user_id ON public.user_news_interactions USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_user_value_profiles_user_id ON public.user_value_profiles USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_v3_account_briefs_account ON v3.account_briefs USING btree (workspace_id, company_id, stage, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_ai_usage_created ON v3.ai_usage_log USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_ai_usage_feature ON v3.ai_usage_log USING btree (feature, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_ai_usage_user ON v3.ai_usage_log USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_ai_usage_workspace ON v3.ai_usage_log USING btree (workspace_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v3_buyer_personas_auto_per_workspace ON v3.buyer_personas USING btree (workspace_id) WHERE (is_auto = true);
CREATE INDEX IF NOT EXISTS idx_v3_campaign_accounts_campaign_id ON v3.campaign_accounts USING btree (campaign_id);
CREATE INDEX IF NOT EXISTS idx_v3_campaign_accounts_company_id ON v3.campaign_accounts USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_v3_campaign_accounts_status ON v3.campaign_accounts USING btree (status);
CREATE INDEX IF NOT EXISTS idx_v3_campaigns_workspace_id ON v3.campaigns USING btree (workspace_id);
CREATE INDEX IF NOT EXISTS idx_v3_chat_conversations_workspace_user ON v3.chat_conversations USING btree (workspace_id, user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_chat_messages_conversation ON v3.chat_messages USING btree (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_v3_dict_suggestions_status ON v3.dictionary_term_suggestions USING btree (status, occurrences DESC);
CREATE INDEX IF NOT EXISTS idx_v3_dictionary_job_titles_process_id ON v3.dictionary_job_titles USING btree (process_id);
CREATE INDEX IF NOT EXISTS idx_v3_dictionary_job_titles_product_id ON v3.dictionary_job_titles USING btree (product_id);
CREATE INDEX IF NOT EXISTS idx_v3_digest_log_account ON v3.digest_log USING btree (followed_account_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_fa_subscribers_account ON v3.followed_account_subscribers USING btree (followed_account_id) WHERE subscribed;
CREATE INDEX IF NOT EXISTS idx_v3_followed_accounts_company ON v3.followed_accounts USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_v3_followed_accounts_refresh ON v3.followed_accounts USING btree (refresh_day) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_v3_followed_accounts_workspace ON v3.followed_accounts USING btree (workspace_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_v3_icebreakers_workspace_company ON v3.icebreakers USING btree (workspace_id, company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_internal_snapshots_account ON v3.account_internal_snapshots USING btree (workspace_id, company_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_mcp_api_keys_key_hash ON v3.mcp_api_keys USING btree (key_hash);
CREATE INDEX IF NOT EXISTS idx_v3_mcp_api_keys_workspace_id ON v3.mcp_api_keys USING btree (workspace_id);
CREATE INDEX IF NOT EXISTS idx_v3_mcp_request_logs_api_key_id ON v3.mcp_request_logs USING btree (api_key_id);
CREATE INDEX IF NOT EXISTS idx_v3_mcp_request_logs_created_at ON v3.mcp_request_logs USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_v3_mcp_request_logs_principal_time ON v3.mcp_request_logs USING btree (principal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_micro_agents_enabled ON v3.radar_micro_agents USING btree (enabled, priority DESC);
CREATE INDEX IF NOT EXISTS idx_v3_research_jobs_batch ON v3.research_jobs USING btree (batch_id);
CREATE INDEX IF NOT EXISTS idx_v3_research_jobs_expired_lease ON v3.research_jobs USING btree (lease_expires_at) WHERE (status = 'running'::text);
CREATE INDEX IF NOT EXISTS idx_v3_research_jobs_quota ON v3.research_jobs USING btree (workspace_id, source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_research_jobs_retry ON v3.research_jobs USING btree (next_retry_at) WHERE (status = 'failed_retriable'::text);
CREATE INDEX IF NOT EXISTS idx_v3_research_jobs_status ON v3.research_jobs USING btree (status) WHERE (status = ANY (ARRAY['pending'::text, 'running'::text]));
CREATE INDEX IF NOT EXISTS idx_v3_research_jobs_workspace ON v3.research_jobs USING btree (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_scorecards_stage ON v3.account_scorecards USING btree (workspace_id, company_id, score_stage, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_scorecards_workspace_company ON v3.account_scorecards USING btree (workspace_id, company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_stage_runs_job ON v3.research_stage_runs USING btree (research_job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_v3_workspace_document_tags_document_id ON v3.workspace_document_tags USING btree (document_id);
CREATE INDEX IF NOT EXISTS idx_v3_workspace_documents_status ON v3.workspace_documents USING btree (status);
CREATE INDEX IF NOT EXISTS idx_v3_workspace_documents_workspace_id ON v3.workspace_documents USING btree (workspace_id);
CREATE INDEX IF NOT EXISTS idx_v3_workspace_invitations_email ON v3.workspace_invitations USING btree (lower(email));
CREATE INDEX IF NOT EXISTS idx_v3_workspace_invitations_token ON v3.workspace_invitations USING btree (token);
CREATE INDEX IF NOT EXISTS idx_v3_workspace_invitations_workspace ON v3.workspace_invitations USING btree (workspace_id);
CREATE INDEX IF NOT EXISTS idx_v3_workspace_members_status ON v3.workspace_members USING btree (status);
CREATE INDEX IF NOT EXISTS idx_v3_workspace_members_user_id ON v3.workspace_members USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_v3_workspace_members_workspace_id ON v3.workspace_members USING btree (workspace_id);
CREATE INDEX IF NOT EXISTS import_batches_created_at_idx ON public.import_batches USING btree (created_at);
CREATE INDEX IF NOT EXISTS mcp_document_drafts_expiry_idx ON v3.mcp_document_drafts USING btree (expires_at) WHERE (status <> 'confirmed'::text);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_document_drafts_workspace_hash_idx ON v3.mcp_document_drafts USING btree (workspace_id, content_hash) WHERE ((content_hash IS NOT NULL) AND (status <> 'expired'::text));
CREATE INDEX IF NOT EXISTS mcp_oauth_codes_expiry_idx ON v3.mcp_oauth_authorization_codes USING btree (expires_at);
CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_user_workspace_idx ON v3.mcp_oauth_tokens USING btree (user_id, workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_usage_reservations_principal_idem_key ON v3.mcp_usage_reservations USING btree (principal_id, pool, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_evidence_details_by_execution ON v3.account_evidence_details USING btree (workspace_id, company_id, term_id, execution_id) WHERE (execution_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_evidence_details_current ON v3.account_evidence_details USING btree (workspace_id, company_id, term_id) WHERE (execution_id IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dup_candidates_group ON v3.company_dup_candidates USING btree (group_key, method);
CREATE UNIQUE INDEX IF NOT EXISTS uq_v3_invitation_pending ON v3.workspace_invitations USING btree (workspace_id, lower(email)) WHERE (status = 'pending'::text);
CREATE UNIQUE INDEX IF NOT EXISTS uq_v3_research_jobs_active_account ON v3.research_jobs USING btree (workspace_id, company_id) WHERE ((company_id IS NOT NULL) AND (force_refresh = false) AND (status = ANY (ARRAY['pending'::text, 'running'::text, 'preliminary_ready'::text])));

-- ============ FUNCTIONS ============
set check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.acquire_cron_lock(p_lock_name text, p_holder text, p_ttl_secs integer DEFAULT 120)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_acquired BOOLEAN := FALSE;
BEGIN
  INSERT INTO public.cron_locks (lock_name) VALUES (p_lock_name) ON CONFLICT (lock_name) DO NOTHING;
  UPDATE public.cron_locks
  SET holder = p_holder, locked_at = now(), locked_until = now() + make_interval(secs => p_ttl_secs)
  WHERE lock_name = p_lock_name AND (locked_until IS NULL OR locked_until < now())
  RETURNING TRUE INTO v_acquired;
  RETURN COALESCE(v_acquired, FALSE);
END; $function$
;

CREATE OR REPLACE FUNCTION public.apollo_get_cached_search(p_query_hash text)
 RETURNS SETOF apollo_search_queries
 LANGUAGE sql
 STABLE
AS $function$
  select * from apollo_search_queries
  where query_hash = p_query_hash
    and expires_at > now()
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.apollo_observe_title(p_title text, p_seniority text DEFAULT NULL::text, p_department text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_norm text;
begin
  if p_title is null or length(trim(p_title)) < 2 then
    return;
  end if;

  -- Misma normalizacion que normalizeTitle() en lib/apollo/query-hash.ts:
  -- trim + lowercase + colapso de espacios internos.
  v_norm := lower(regexp_replace(trim(p_title), '\s+', ' ', 'g'));

  insert into public.apollo_title_catalog as t (
    normalized_title, display_title, seniority, department,
    aliases, usage_count, success_count
  )
  values (
    v_norm, trim(p_title), p_seniority, p_department,
    array[]::text[], 1, 0
  )
  on conflict (normalized_title) do update
    set usage_count = t.usage_count + 1,
        last_seen_at = now(),
        updated_at = now(),
        seniority = coalesce(t.seniority, excluded.seniority),
        department = coalesce(t.department, excluded.department);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.apollo_record_title_observation(p_title text, p_seniority text DEFAULT NULL::text, p_department text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_normalized text;
  v_display text;
begin
  if p_title is null or trim(p_title) = '' then
    return;
  end if;

  v_display := trim(p_title);
  v_normalized := lower(v_display);

  insert into apollo_title_catalog (
    normalized_title, display_title, seniority, department, usage_count, last_seen_at
  ) values (
    v_normalized, v_display, p_seniority, p_department, 1, now()
  )
  on conflict (normalized_title) do update set
    usage_count = apollo_title_catalog.usage_count + 1,
    last_seen_at = now(),
    updated_at = now(),
    seniority = coalesce(apollo_title_catalog.seniority, excluded.seniority),
    department = coalesce(apollo_title_catalog.department, excluded.department);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.apollo_record_title_success(p_title text, p_entries integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_normalized text;
begin
  if p_title is null or trim(p_title) = '' then
    return;
  end if;

  v_normalized := lower(trim(p_title));

  update apollo_title_catalog
  set success_count = success_count + 1,
      last_success_entries = p_entries,
      updated_at = now()
  where normalized_title = v_normalized;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.auto_merge_safe_duplicates(p_limit integer DEFAULT 50)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
    group_record RECORD;
    company_record RECORD;
    master_id UUID;
    merged_count INTEGER := 0;
    companies_in_group JSONB;
    company_item JSONB;
    has_linkedin_count INTEGER;
    distinct_linkedin_urls TEXT[];
    candidate_master_id UUID;
    candidate_master_score INTEGER;
    current_score INTEGER;
BEGIN
    FOR group_record IN 
        SELECT 
            normalized_name,
            jsonb_agg(
                jsonb_build_object(
                    'id', id,
                    'name', name,
                    'linkedin_url', linkedin_url,
                    'created_at', created_at
                )
            ) as companies
        FROM public.companies
        WHERE normalized_name IS NOT NULL
          AND normalized_name != 'unknown company'  -- Excluir Unknown Company
        GROUP BY normalized_name
        HAVING COUNT(*) > 1
        LIMIT p_limit
    LOOP
        companies_in_group := group_record.companies;
        
        SELECT 
            COUNT(CASE WHEN (c->>'linkedin_url') IS NOT NULL AND (c->>'linkedin_url') <> '' THEN 1 END),
            ARRAY_AGG(DISTINCT (c->>'linkedin_url')) FILTER (WHERE (c->>'linkedin_url') IS NOT NULL AND (c->>'linkedin_url') <> '')
        INTO has_linkedin_count, distinct_linkedin_urls
        FROM jsonb_array_elements(companies_in_group) as c;

        IF array_length(distinct_linkedin_urls, 1) > 1 THEN
            CONTINUE;
        END IF;

        candidate_master_id := NULL;
        candidate_master_score := -1;

        FOR company_item IN SELECT * FROM jsonb_array_elements(companies_in_group)
        LOOP
            current_score := 0;
            IF (company_item->>'linkedin_url') IS NOT NULL AND (company_item->>'linkedin_url') <> '' THEN
                current_score := current_score + 100;
            END IF;
            current_score := current_score + length(company_item->>'name');
            IF current_score > candidate_master_score THEN
                candidate_master_score := current_score;
                candidate_master_id := (company_item->>'id')::UUID;
            END IF;
        END LOOP;

        IF candidate_master_id IS NOT NULL THEN
            FOR company_item IN SELECT * FROM jsonb_array_elements(companies_in_group)
            LOOP
                IF (company_item->>'id')::UUID <> candidate_master_id THEN
                    PERFORM public.merge_companies(candidate_master_id, (company_item->>'id')::UUID);
                END IF;
            END LOOP;
            merged_count := merged_count + 1;
        END IF;
    END LOOP;

    RETURN merged_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.auto_merge_safe_duplicates()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'v3', 'pg_catalog'
AS $function$
DECLARE v_res JSONB;
BEGIN
  v_res := v3.auto_merge_safe_candidates(100, false, NULL);
  RETURN coalesce((v_res->>'groups')::int, 0);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.build_combined_pattern(p_keywords text[])
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT '\y(' || array_to_string(
    ARRAY(SELECT public.escape_regex(kw) FROM unnest(p_keywords) kw),
    '|'
  ) || ')\y';
$function$
;

CREATE OR REPLACE FUNCTION public.check_pending_signals_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.signal_type = 'contact' AND NEW.contact_id IS NULL THEN
    RAISE EXCEPTION 'contact_id required for contact signals';
  END IF;
  IF NEW.signal_type = 'job' AND NEW.job_id IS NULL THEN
    RAISE EXCEPTION 'job_id required for job signals';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_old_health_logs()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  DELETE FROM system_health_logs 
  WHERE created_at < NOW() - INTERVAL '7 days';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_old_import_data(p_processed_retention_days integer DEFAULT 30, p_failed_retention_days integer DEFAULT 90)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_deleted_processed INT := 0;
  v_deleted_failed INT := 0;
  v_deleted_debug INT := 0;
  v_deleted_batches INT := 0;
BEGIN
  -- 1. Delete PROCESSED import_rows older than retention period
  -- Only from batches that have zero pending rows (fully done)
  DELETE FROM public.import_rows ir
  WHERE ir.status = 'processed'
    AND ir.processed_at < NOW() - (p_processed_retention_days || ' days')::INTERVAL
    AND NOT EXISTS (
      SELECT 1 FROM public.import_rows ir2
      WHERE ir2.batch_id = ir.batch_id
        AND ir2.status = 'pending'
    );
  GET DIAGNOSTICS v_deleted_processed = ROW_COUNT;

  -- 2. Delete FAILED import_rows older than extended retention period
  DELETE FROM public.import_rows ir
  WHERE ir.status = 'failed'
    AND ir.processed_at < NOW() - (p_failed_retention_days || ' days')::INTERVAL
    AND NOT EXISTS (
      SELECT 1 FROM public.import_rows ir2
      WHERE ir2.batch_id = ir.batch_id
        AND ir2.status = 'pending'
    );
  GET DIAGNOSTICS v_deleted_failed = ROW_COUNT;

  -- 3. Delete import_batches that have no remaining import_rows
  DELETE FROM public.import_batches ib
  WHERE ib.status = 'completed'
    AND ib.created_at < NOW() - (p_processed_retention_days || ' days')::INTERVAL
    AND NOT EXISTS (
      SELECT 1 FROM public.import_rows ir WHERE ir.batch_id = ib.id
    );
  GET DIAGNOSTICS v_deleted_batches = ROW_COUNT;

  -- 4. Delete old debug_events
  DELETE FROM public.debug_events
  WHERE created_at < NOW() - (p_processed_retention_days || ' days')::INTERVAL;
  GET DIAGNOSTICS v_deleted_debug = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted_processed_rows', v_deleted_processed,
    'deleted_failed_rows', v_deleted_failed,
    'deleted_empty_batches', v_deleted_batches,
    'deleted_debug_events', v_deleted_debug
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.company_core_name(p_name text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
  SELECT nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            split_part(
              regexp_replace(unaccent(lower(btrim(coalesce(p_name, '')))), '["''`]', '', 'g'),
              '/', 1
            ),
            '^(grupo|group|holding|the)\s+', ''
          ),
          '\s*[,\.]?\s*(s\.?a\.?i\.?c\.?f?\.?|s\.?a\.?c\.?i\.?|s\.?a\.?s\.?|s\.?a\.?u\.?|s\.?a\.?|s\.?r\.?l\.?|s\.?c\.?a\.?|inc|llc|ltda?|corp|co|plc|gmbh|ag|nv|bv|spa|srl|pty|limited)\s*$',
          ''
        ),
        '\s+', ' ', 'g'
      )
    ),
    ''
  );
$function$
;

CREATE OR REPLACE FUNCTION public.contacts_prevpos_text(prev jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT COALESCE(
    string_agg(
      COALESCE(e->>'title','') || ' ' || COALESCE(e->>'description',''),
      ' | ' ORDER BY ord
    ),
    ''
  )
  FROM jsonb_array_elements(
         CASE WHEN jsonb_typeof(prev) = 'array' THEN prev ELSE '[]'::jsonb END
       ) WITH ORDINALITY AS t(e, ord)
$function$
;

CREATE OR REPLACE FUNCTION public.create_bookmarks(p_user_id uuid, p_company_ids uuid[], p_search_context jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(bookmark_id uuid, company_id uuid, was_created boolean)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'v3', 'pg_catalog'
AS $function$
DECLARE
  v_cid  UUID;
  v_id   UUID;
  v_ck   TEXT := v3.bookmark_context_key(p_search_context);
BEGIN
  -- Se recorre empresa por empresa, cada INSERT en su propio bloque con
  -- EXCEPTION. Dos motivos para hacerlo asi en vez de un INSERT ... ON CONFLICT:
  --
  --  1. Aislamiento: un choque no puede tumbar a las otras 49. Cada bloque
  --     BEGIN/EXCEPTION es una subtransaccion, asi que si una empresa falla, esa
  --     sola se descarta y el resto se guarda igual. Ese era exactamente el bug
  --     de bookmarkCompanyBatch.
  --  2. No depende del indice. `ON CONFLICT (expresion)` exige que exista un
  --     indice unico que matchee, asi que la RPC no se podria crear antes del
  --     421. Con el handler, esto funciona con el indice y sin el, y por eso se
  --     puede deployar la app sin haber creado todavia el constraint.
  --
  -- El DISTINCT importa: si el array trae la misma empresa repetida, el segundo
  -- INSERT choca contra el primero de esta misma llamada.
  FOR v_cid IN SELECT DISTINCT unnest(p_company_ids) LOOP
    v_id := NULL;

    -- Camino feliz: no existe, se crea.
    BEGIN
      INSERT INTO public.bookmarks (user_id, company_id, search_context)
      SELECT p_user_id, v_cid, p_search_context
      WHERE NOT EXISTS (
        SELECT 1 FROM public.bookmarks b
        WHERE b.user_id = p_user_id
          AND b.company_id = v_cid
          AND v3.bookmark_context_key(b.search_context) = v_ck
      )
      RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      -- Perdio la carrera contra otra pestaña entre el NOT EXISTS y el INSERT.
      -- No es un error para el usuario: el bookmark existe, que es lo que pedia.
      v_id := NULL;
    END;

    IF v_id IS NOT NULL THEN
      RETURN QUERY SELECT v_id, v_cid, true;
    ELSE
      -- Ya estaba (o lo acaba de crear el otro request). Se devuelve el id igual,
      -- asi el caller no necesita distinguir "lo cree" de "ya existia" para poder
      -- navegar al bookmark.
      RETURN QUERY
      SELECT b.id, v_cid, false
      FROM public.bookmarks b
      WHERE b.user_id = p_user_id
        AND b.company_id = v_cid
        AND v3.bookmark_context_key(b.search_context) = v_ck
      ORDER BY b.created_at, b.id
      LIMIT 1;
    END IF;
  END LOOP;
END $function$
;

CREATE OR REPLACE FUNCTION public.escape_regex(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT regexp_replace(p_text, '([.*+?^${}()|[\]\\])', '\\\1', 'g');
$function$
;

CREATE OR REPLACE FUNCTION public.export_companies(p_signal_type text DEFAULT NULL::text, p_signal_names text[] DEFAULT NULL::text[], p_countries text[] DEFAULT NULL::text[], p_industries text[] DEFAULT NULL::text[], p_limit integer DEFAULT 10000)
 RETURNS TABLE(company_id uuid, company_name text, industry text, country text, linkedin_url text, website text, total_signals bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '55s'
AS $function$
DECLARE
  v_signal_ids uuid[];
BEGIN
  IF p_signal_names IS NOT NULL THEN
    SELECT array_agg(id) INTO v_signal_ids
    FROM (
      SELECT id FROM dictionary_processes
        WHERE name = ANY(p_signal_names)
          AND (p_signal_type IS NULL OR p_signal_type = 'process')
      UNION ALL
      SELECT id FROM dictionary_products
        WHERE name = ANY(p_signal_names)
          AND (p_signal_type IS NULL OR p_signal_type = 'technology')
    ) d;
    v_signal_ids := COALESCE(v_signal_ids, '{}'::uuid[]);
  END IF;

  RETURN QUERY
  WITH agg AS (
    SELECT s.company_id, COUNT(*)::BIGINT AS total
    FROM signals s
    WHERE s.company_id IS NOT NULL
      AND (p_signal_type IS NULL OR s.signal_type = p_signal_type)
      AND (v_signal_ids IS NULL OR s.signal_id = ANY(v_signal_ids))
    GROUP BY s.company_id
  )
  SELECT
    comp.id AS company_id,
    comp.name::TEXT AS company_name,
    comp.industry::TEXT AS industry,
    comp.country_normalized::TEXT AS country,
    comp.linkedin_url::TEXT AS linkedin_url,
    comp.website::TEXT AS website,
    a.total AS total_signals
  FROM agg a
  JOIN companies comp ON comp.id = a.company_id
  WHERE (p_countries IS NULL OR comp.country_normalized = ANY(p_countries))
    AND (p_industries IS NULL OR comp.industry = ANY(p_industries))
  ORDER BY a.total DESC, comp.name ASC
  LIMIT p_limit;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.export_companies_countries()
 RETURNS text[]
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
  SELECT COALESCE(array_agg(c ORDER BY c), '{}')
  FROM (
    SELECT DISTINCT country_normalized AS c
    FROM companies
    WHERE country_normalized IS NOT NULL AND country_normalized <> ''
  ) x;
$function$
;

CREATE OR REPLACE FUNCTION public.export_companies_industries()
 RETURNS text[]
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
  SELECT COALESCE(array_agg(i ORDER BY i), '{}')
  FROM (
    SELECT DISTINCT industry AS i
    FROM companies
    WHERE industry IS NOT NULL AND industry <> ''
  ) x;
$function$
;

CREATE OR REPLACE FUNCTION public.export_companies_with_signals(p_signal_type text DEFAULT NULL::text, p_signal_names text[] DEFAULT NULL::text[], p_countries text[] DEFAULT NULL::text[], p_industries text[] DEFAULT NULL::text[], p_exclude_providers boolean DEFAULT false, p_limit integer DEFAULT 1000)
 RETURNS TABLE(company_id uuid, company_name text, website text, linkedin_url text, country text, industry text, total_signals bigint, process_signals bigint, technology_signals bigint)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    c.id as company_id,
    c.name as company_name,
    c.website,
    c.linkedin_url,
    c.country_normalized as country,
    c.industry,
    COUNT(s.id) as total_signals,
    COUNT(CASE WHEN s.signal_type = 'process' THEN 1 END) as process_signals,
    COUNT(CASE WHEN s.signal_type = 'technology' THEN 1 END) as technology_signals
  FROM signals s
  INNER JOIN companies c ON s.company_id = c.id
  LEFT JOIN dictionary_processes dp ON s.signal_id = dp.id AND s.signal_type = 'process'
  LEFT JOIN dictionary_products dprod ON s.signal_id = dprod.id AND s.signal_type = 'technology'
  WHERE 
    -- Filtro por tipo de señal
    (p_signal_type IS NULL OR s.signal_type = p_signal_type)
    -- Filtro por nombres de señales específicas
    AND (
      p_signal_names IS NULL 
      OR (s.signal_type = 'process' AND dp.name = ANY(p_signal_names))
      OR (s.signal_type = 'technology' AND dprod.name = ANY(p_signal_names))
    )
    -- Filtro por países
    AND (p_countries IS NULL OR c.country_normalized = ANY(p_countries))
    -- Filtro por industrias
    AND (p_industries IS NULL OR c.industry = ANY(p_industries))
    -- Excluir proveedores de servicios por master_industry_id
    AND (NOT p_exclude_providers OR c.master_industry_id IS NULL OR c.master_industry_id != 'service_provider')
  GROUP BY c.id, c.name, c.website, c.linkedin_url, c.country_normalized, c.industry
  HAVING COUNT(s.id) > 0
  ORDER BY COUNT(s.id) DESC
  LIMIT p_limit;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.export_contacts(p_signal_type text DEFAULT NULL::text, p_signal_names text[] DEFAULT NULL::text[], p_countries text[] DEFAULT NULL::text[], p_industries text[] DEFAULT NULL::text[], p_only_corporate_email boolean DEFAULT false, p_limit integer DEFAULT 10000)
 RETURNS TABLE(contact_id uuid, first_name text, last_name text, full_name text, job_title text, company_name text, company_country text, contact_country text, linkedin_url text, email text, signal_type text, signal_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (c.id, 
    CASE 
      WHEN s.signal_type = 'process' THEN dp.name
      ELSE dprod.name
    END)
    c.id as contact_id,
    c.first_name::TEXT,
    c.last_name::TEXT,
    COALESCE(c.full_name, CONCAT(c.first_name, ' ', c.last_name))::TEXT as full_name,
    c.current_position_title::TEXT as job_title,
    comp.name::TEXT as company_name,
    comp.country_normalized::TEXT as company_country,
    c.country_normalized::TEXT as contact_country,
    c.linkedin_url::TEXT,
    COALESCE(c.email1, c.email2, c.email3)::TEXT as email,
    s.signal_type::TEXT,
    CASE 
      WHEN s.signal_type = 'process' THEN dp.name
      ELSE dprod.name
    END::TEXT as signal_name
  FROM signals s
  -- Join to get signal name from dictionary
  LEFT JOIN dictionary_processes dp ON s.signal_id = dp.id AND s.signal_type = 'process'
  LEFT JOIN dictionary_products dprod ON s.signal_id = dprod.id AND s.signal_type = 'technology'
  -- Join to get company info
  INNER JOIN companies comp ON s.company_id = comp.id
  -- Join to get contact info (INNER JOIN = only signals with contacts)
  INNER JOIN contacts c ON s.contact_id = c.id
  WHERE 
    -- Must have a contact
    s.contact_id IS NOT NULL
    -- Filter by signal type
    AND (p_signal_type IS NULL OR s.signal_type = p_signal_type)
    -- Filter by signal names (from dictionary)
    AND (
      p_signal_names IS NULL 
      OR (s.signal_type = 'process' AND dp.name = ANY(p_signal_names))
      OR (s.signal_type = 'technology' AND dprod.name = ANY(p_signal_names))
    )
    -- Filter by country of CONTACT (using country_normalized)
    AND (p_countries IS NULL OR c.country_normalized = ANY(p_countries))
    -- Filter by industries
    AND (p_industries IS NULL OR comp.industry = ANY(p_industries))
    -- Filter corporate emails
    AND (
      NOT p_only_corporate_email
      OR (
        COALESCE(c.email1, c.email2, c.email3) IS NOT NULL
        AND LOWER(COALESCE(c.email1, c.email2, c.email3)) NOT LIKE '%@gmail.com'
        AND LOWER(COALESCE(c.email1, c.email2, c.email3)) NOT LIKE '%@hotmail.com'
        AND LOWER(COALESCE(c.email1, c.email2, c.email3)) NOT LIKE '%@yahoo.com'
        AND LOWER(COALESCE(c.email1, c.email2, c.email3)) NOT LIKE '%@outlook.com'
        AND LOWER(COALESCE(c.email1, c.email2, c.email3)) NOT LIKE '%@live.com'
        AND LOWER(COALESCE(c.email1, c.email2, c.email3)) NOT LIKE '%@icloud.com'
        AND LOWER(COALESCE(c.email1, c.email2, c.email3)) NOT LIKE '%@protonmail.com'
        AND LOWER(COALESCE(c.email1, c.email2, c.email3)) NOT LIKE '%@aol.com'
      )
    )
  ORDER BY c.id, 
    CASE 
      WHEN s.signal_type = 'process' THEN dp.name
      ELSE dprod.name
    END,
    comp.name
  LIMIT p_limit;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.export_job_postings(p_signal_type text DEFAULT NULL::text, p_signal_names text[] DEFAULT NULL::text[], p_countries text[] DEFAULT NULL::text[], p_industries text[] DEFAULT NULL::text[], p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_location_query text DEFAULT NULL::text, p_title_query text DEFAULT NULL::text, p_only_active boolean DEFAULT false, p_only_with_signals boolean DEFAULT false, p_include_description boolean DEFAULT false, p_limit integer DEFAULT 1000, p_offset integer DEFAULT 0)
 RETURNS TABLE(job_id uuid, title text, company_name text, country text, industry text, location text, posted_at timestamp with time zone, is_active boolean, job_url text, apply_url text, signal_count bigint, signals_process text, signals_technology text, description text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '55s'
AS $function$
DECLARE
  v_signal_ids uuid[];
  v_filter_signals boolean;
BEGIN
  v_filter_signals := p_signal_names IS NOT NULL
                      AND array_length(p_signal_names, 1) > 0;

  IF v_filter_signals THEN
    SELECT array_agg(id) INTO v_signal_ids
    FROM (
      SELECT id FROM dictionary_processes
        WHERE name = ANY(p_signal_names)
          AND (p_signal_type IS NULL OR p_signal_type = 'process')
      UNION ALL
      SELECT id FROM dictionary_products
        WHERE name = ANY(p_signal_names)
          AND (p_signal_type IS NULL OR p_signal_type = 'technology')
    ) d;
    v_signal_ids := COALESCE(v_signal_ids, '{}'::uuid[]);
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      j.id, j.title, j.location, j.posted_at, j.is_active,
      j.job_url, j.apply_url, j.description,
      c.name AS c_name,
      c.country_normalized AS c_country,
      c.industry AS c_industry
    FROM job_postings j
    LEFT JOIN companies c ON c.id = j.company_id
    WHERE (p_date_from IS NULL OR j.posted_at >= p_date_from::timestamptz)
      AND (p_date_to IS NULL OR j.posted_at < (p_date_to + 1)::timestamptz)
      AND (NOT p_only_active OR j.is_active = true)
      AND (p_countries IS NULL OR c.country_normalized = ANY(p_countries))
      AND (p_industries IS NULL OR c.industry = ANY(p_industries))
      AND (p_location_query IS NULL OR j.location ILIKE '%' || p_location_query || '%')
      AND (p_title_query IS NULL OR j.title ILIKE '%' || p_title_query || '%')
      AND (
        NOT v_filter_signals
        OR EXISTS (
          SELECT 1 FROM signals s
          WHERE s.job_posting_id = j.id
            AND s.signal_id = ANY(v_signal_ids)
            AND (p_signal_type IS NULL OR s.signal_type = p_signal_type)
        )
      )
      AND (
        NOT p_only_with_signals
        OR EXISTS (SELECT 1 FROM signals s2 WHERE s2.job_posting_id = j.id)
      )
  )
  SELECT
    b.id AS job_id,
    b.title::TEXT,
    b.c_name::TEXT AS company_name,
    b.c_country::TEXT AS country,
    b.c_industry::TEXT AS industry,
    b.location::TEXT,
    b.posted_at,
    b.is_active,
    b.job_url::TEXT,
    b.apply_url::TEXT,
    COALESCE(sg.cnt, 0)::BIGINT AS signal_count,
    sg.procs AS signals_process,
    sg.techs AS signals_technology,
    CASE WHEN p_include_description THEN b.description::TEXT ELSE NULL END AS description
  FROM base b
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::BIGINT AS cnt,
      NULLIF(string_agg(DISTINCT dpr.name, '; '), '') AS procs,
      NULLIF(string_agg(DISTINCT dp.name, '; '), '') AS techs
    FROM signals s
    LEFT JOIN dictionary_processes dpr
      ON dpr.id = s.signal_id AND s.signal_type = 'process'
    LEFT JOIN dictionary_products dp
      ON dp.id = s.signal_id AND s.signal_type = 'technology'
    WHERE s.job_posting_id = b.id
  ) sg ON TRUE
  ORDER BY b.posted_at DESC NULLS LAST, b.id
  LIMIT p_limit OFFSET p_offset;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.export_job_postings_count(p_signal_type text DEFAULT NULL::text, p_signal_names text[] DEFAULT NULL::text[], p_countries text[] DEFAULT NULL::text[], p_industries text[] DEFAULT NULL::text[], p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_location_query text DEFAULT NULL::text, p_title_query text DEFAULT NULL::text, p_only_active boolean DEFAULT false, p_only_with_signals boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '55s'
AS $function$
DECLARE
  v_signal_ids uuid[];
  v_filter_signals boolean;
  v_total bigint;
BEGIN
  v_filter_signals := p_signal_names IS NOT NULL
                      AND array_length(p_signal_names, 1) > 0;

  IF v_filter_signals THEN
    SELECT array_agg(id) INTO v_signal_ids
    FROM (
      SELECT id FROM dictionary_processes
        WHERE name = ANY(p_signal_names)
          AND (p_signal_type IS NULL OR p_signal_type = 'process')
      UNION ALL
      SELECT id FROM dictionary_products
        WHERE name = ANY(p_signal_names)
          AND (p_signal_type IS NULL OR p_signal_type = 'technology')
    ) d;
    v_signal_ids := COALESCE(v_signal_ids, '{}'::uuid[]);
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM job_postings j
  LEFT JOIN companies c ON c.id = j.company_id
  WHERE (p_date_from IS NULL OR j.posted_at >= p_date_from::timestamptz)
    AND (p_date_to IS NULL OR j.posted_at < (p_date_to + 1)::timestamptz)
    AND (NOT p_only_active OR j.is_active = true)
    AND (p_countries IS NULL OR c.country_normalized = ANY(p_countries))
    AND (p_industries IS NULL OR c.industry = ANY(p_industries))
    AND (p_location_query IS NULL OR j.location ILIKE '%' || p_location_query || '%')
    AND (p_title_query IS NULL OR j.title ILIKE '%' || p_title_query || '%')
    AND (
      NOT v_filter_signals
      OR EXISTS (
        SELECT 1 FROM signals s
        WHERE s.job_posting_id = j.id
          AND s.signal_id = ANY(v_signal_ids)
          AND (p_signal_type IS NULL OR s.signal_type = p_signal_type)
      )
    )
    AND (
      NOT p_only_with_signals
      OR EXISTS (SELECT 1 FROM signals s2 WHERE s2.job_posting_id = j.id)
    );

  RETURN COALESCE(v_total, 0);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.export_job_postings_countries()
 RETURNS TABLE(country text, job_count bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
  SELECT c.country_normalized::TEXT AS country, COUNT(*)::BIGINT AS job_count
  FROM job_postings j
  JOIN companies c ON c.id = j.company_id
  WHERE c.country_normalized IS NOT NULL AND c.country_normalized <> ''
  GROUP BY c.country_normalized
  ORDER BY COUNT(*) DESC, c.country_normalized ASC;
$function$
;

CREATE OR REPLACE FUNCTION public.export_job_postings_industries()
 RETURNS TABLE(industry text, job_count bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
  SELECT c.industry::TEXT AS industry, COUNT(*)::BIGINT AS job_count
  FROM job_postings j
  JOIN companies c ON c.id = j.company_id
  WHERE c.industry IS NOT NULL AND c.industry <> ''
  GROUP BY c.industry
  ORDER BY COUNT(*) DESC, c.industry ASC;
$function$
;

CREATE OR REPLACE FUNCTION public.export_job_postings_stats()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '45s'
AS $function$
  SELECT jsonb_build_object(
    'total_jobs',       (SELECT COUNT(*) FROM job_postings),
    'active_jobs',      (SELECT COUNT(*) FROM job_postings WHERE is_active = true),
    'with_signals',     (SELECT COUNT(DISTINCT job_posting_id) FROM signals WHERE job_posting_id IS NOT NULL),
    'with_country',     (SELECT COUNT(*) FROM job_postings j JOIN companies c ON c.id = j.company_id
                          WHERE c.country_normalized IS NOT NULL AND c.country_normalized <> ''),
    'companies',        (SELECT COUNT(DISTINCT company_id) FROM job_postings WHERE company_id IS NOT NULL),
    'date_min',         (SELECT MIN(posted_at)::date FROM job_postings),
    'date_max',         (SELECT MAX(posted_at)::date FROM job_postings)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.extract_company_from_headline(p_headline text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_empresa TEXT;
  v_pos_en INTEGER;
  v_pos_at INTEGER;
BEGIN
  IF p_headline IS NULL OR p_headline = '' THEN
    RETURN NULL;
  END IF;
  
  -- Buscar " en " (case insensitive)
  v_pos_en := POSITION(' en ' IN LOWER(p_headline));
  -- Buscar " at " (case insensitive)
  v_pos_at := POSITION(' at ' IN LOWER(p_headline));
  
  -- Usar el que esté más cerca del final (más probable que sea la empresa)
  IF v_pos_en > 0 AND (v_pos_at = 0 OR v_pos_en > v_pos_at) THEN
    v_empresa := TRIM(SUBSTRING(p_headline FROM v_pos_en + 4));
  ELSIF v_pos_at > 0 THEN
    v_empresa := TRIM(SUBSTRING(p_headline FROM v_pos_at + 4));
  ELSE
    RETURN NULL;
  END IF;
  
  -- Limpiar caracteres especiales al final
  v_empresa := RTRIM(v_empresa, ' .-,;:');
  
  -- Si es muy corto, probablemente no es válido
  IF LENGTH(v_empresa) < 3 THEN
    RETURN NULL;
  END IF;
  
  RETURN v_empresa;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.extract_linkedin_company_slug(p_url text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_slug TEXT;
BEGIN
  IF p_url IS NULL OR p_url = '' THEN
    RETURN NULL;
  END IF;
  
  -- Extraer el slug de la URL de LinkedIn company
  -- Soporta formatos:
  --   https://ar.linkedin.com/company/marvalofarrell?trk=...
  --   https://www.linkedin.com/company/marvalofarrell
  --   https://linkedin.com/company/marvalofarrell/
  --   linkedin.com/company/marvalofarrell
  
  -- Usar regex para extraer solo el slug después de /company/
  v_slug := (regexp_match(LOWER(p_url), 'linkedin\.com/company/([^/?#]+)'))[1];
  
  RETURN v_slug;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.extract_snippet(text_content text, keyword text, context_chars integer DEFAULT 100)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  keyword_position INTEGER;
  snippet_start INTEGER;
  snippet_length INTEGER;
  result_snippet TEXT;
BEGIN
  -- Find case-insensitive position of keyword using regexp_instr
  keyword_position := regexp_instr(text_content, '\y' || keyword || '\y', 1, 1, 0, 'i');
  
  -- If keyword not found, return first 200 chars as fallback
  IF keyword_position = 0 OR keyword_position IS NULL THEN
    RETURN substring(text_content from 1 for 200);
  END IF;
  
  -- Calculate snippet boundaries (context_chars before and after keyword)
  snippet_start := GREATEST(1, keyword_position - context_chars);
  snippet_length := (context_chars * 2) + length(keyword);
  
  -- Extract snippet
  result_snippet := substring(text_content from snippet_start for snippet_length);
  
  -- Clean up: trim whitespace
  result_snippet := TRIM(result_snippet);
  
  RETURN result_snippet;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.finalize_batch_upload(p_batch_id uuid, p_total_rows integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_actual_rows INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_actual_rows FROM public.import_rows WHERE batch_id = p_batch_id;

  IF v_actual_rows <> p_total_rows THEN
    UPDATE public.import_batches
    SET status = 'failed',
        error_message = format('Row count mismatch on upload: expected %s, found %s', p_total_rows, v_actual_rows),
        total_rows = v_actual_rows, updated_at = timezone('utc', now())
    WHERE id = p_batch_id;
    RETURN jsonb_build_object('status','failed','expected',p_total_rows,'found',v_actual_rows);
  END IF;

  UPDATE public.import_batches
  SET status = 'pending', total_rows = v_actual_rows, updated_at = timezone('utc', now())
  WHERE id = p_batch_id;

  INSERT INTO public.debug_events (batch_id, event_type, message, details)
  VALUES (p_batch_id, 'upload_finalized', 'All rows inserted, batch queued',
          jsonb_build_object('total_rows', v_actual_rows));

  RETURN jsonb_build_object('status','pending','total_rows',v_actual_rows);
END; $function$
;

CREATE OR REPLACE FUNCTION public.get_available_countries_for_export()
 RETURNS TABLE(country_normalized text, company_count bigint)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT 
    country_normalized,
    COUNT(*) as company_count
  FROM companies
  WHERE country_normalized IS NOT NULL 
    AND country_normalized != ''
  GROUP BY country_normalized
  ORDER BY company_count DESC;
$function$
;

CREATE OR REPLACE FUNCTION public.get_bookmark_export_data(p_bookmark_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_company_id UUID;
  v_search_context JSONB;
  v_filter_signal_ids UUID[];
  v_has_scope_filter BOOLEAN;
  v_result JSONB;
BEGIN
  SELECT company_id, search_context
  INTO v_company_id, v_search_context
  FROM bookmarks
  WHERE id = p_bookmark_id AND user_id = p_user_id;

  IF v_company_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT ARRAY(
    SELECT elem::UUID
    FROM jsonb_array_elements_text(
      COALESCE(v_search_context->'filterSignalIds', '[]'::jsonb)
    ) AS elem
    WHERE elem IS NOT NULL AND elem != ''
  ) INTO v_filter_signal_ids;

  v_has_scope_filter := (
    array_length(v_filter_signal_ids, 1) IS NOT NULL
    AND array_length(v_filter_signal_ids, 1) > 0
  );

  SELECT jsonb_build_object(

    'company', (
      SELECT jsonb_build_object(
        'name', c.name,
        'country', c.country_normalized,
        'industry', c.industry,
        'website', c.website,
        'linkedin_url', c.linkedin_url,
        'employee_count', NULL
      )
      FROM companies c
      WHERE c.id = v_company_id
    ),

    'bookmark', (
      SELECT jsonb_build_object(
        'status', b.status,
        'priority', b.priority,
        'notes', b.notes,
        'search_context', b.search_context,
        'created_at', b.created_at
      )
      FROM bookmarks b
      WHERE b.id = p_bookmark_id
    ),

    'strategy', (
      SELECT jsonb_build_object(
        'recommended_pitch', ucs.recommended_pitch,
        'sender_context_override', ucs.sender_context_override
      )
      FROM user_company_strategies ucs
      WHERE ucs.bookmark_id = p_bookmark_id AND ucs.user_id = p_user_id
    ),

    -- Empleados con senales: ahora exponemos todos los slots de email y phone
    -- con tipo y status para que el usuario pueda priorizar en Excel.
    'employees_with_signals', COALESCE((
      SELECT jsonb_agg(emp_row ORDER BY (emp_row->>'signal_count')::int DESC NULLS LAST)
      FROM (
        SELECT DISTINCT ON (ct.id) jsonb_build_object(
          'first_name', ct.first_name,
          'last_name', ct.last_name,
          'position', ct.current_position_title,
          'linkedin_url', ct.linkedin_url,

          -- Slot 1 de email
          'email1', ct.email1,
          'email1_type', ct.email1_type,
          'email1_status', ct.email1_status,

          -- Slot 2 de email
          'email2', ct.email2,
          'email2_type', ct.email2_type,
          'email2_status', ct.email2_status,

          -- Slot 1 de telefono
          'phone1', ct.phone1,
          'phone1_type', ct.phone1_type,
          'phone1_status', ct.phone1_status,

          -- Slot 2 de telefono
          'phone2', ct.phone2,
          'phone2_type', ct.phone2_type,
          'phone2_status', ct.phone2_status,

          'signal_count', (
            SELECT COUNT(*)
            FROM signals s
            WHERE s.contact_id = ct.id
              AND s.is_current_employee = true
              AND (NOT v_has_scope_filter OR s.signal_id = ANY(v_filter_signal_ids))
          ),
          'signals', (
            SELECT jsonb_agg(jsonb_build_object(
              'signal_type', s.signal_type,
              'signal_name', COALESCE(dp.name, dpr.name, s.keyword_matched),
              'source', s.source_field,
              'snippet', LEFT(s.snippet, 200)
            ))
            FROM signals s
            LEFT JOIN dictionary_products dp ON dp.id = s.signal_id AND s.signal_type = 'technology'
            LEFT JOIN dictionary_processes dpr ON dpr.id = s.signal_id AND s.signal_type = 'process'
            WHERE s.contact_id = ct.id
              AND s.is_current_employee = true
              AND (NOT v_has_scope_filter OR s.signal_id = ANY(v_filter_signal_ids))
          )
        ) AS emp_row
        FROM contacts ct
        WHERE ct.current_company_id = v_company_id
          AND EXISTS (
            SELECT 1 FROM signals sig
            WHERE sig.contact_id = ct.id
              AND sig.is_current_employee = true
              AND (NOT v_has_scope_filter OR sig.signal_id = ANY(v_filter_signal_ids))
          )
      ) sub
      WHERE (emp_row->>'signal_count')::int > 0
    ), '[]'::jsonb),

    'job_postings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'title', jp.title,
        'url', jp.job_url,
        'location', jp.location,
        'posted_at', jp.posted_at,
        'is_active', jp.is_active,
        'signals', (
          SELECT jsonb_agg(jsonb_build_object(
            'signal_type', s.signal_type,
            'signal_name', COALESCE(dp.name, dpr.name, s.keyword_matched)
          ))
          FROM signals s
          LEFT JOIN dictionary_products dp ON dp.id = s.signal_id AND s.signal_type = 'technology'
          LEFT JOIN dictionary_processes dpr ON dpr.id = s.signal_id AND s.signal_type = 'process'
          WHERE s.job_posting_id = jp.id
            AND (NOT v_has_scope_filter OR s.signal_id = ANY(v_filter_signal_ids))
        )
      ) ORDER BY jp.posted_at DESC NULLS LAST)
      FROM job_postings jp
      WHERE jp.company_id = v_company_id
        AND jp.is_active = true
        AND EXISTS (
          SELECT 1 FROM signals sig
          WHERE sig.job_posting_id = jp.id
            AND (NOT v_has_scope_filter OR sig.signal_id = ANY(v_filter_signal_ids))
        )
    ), '[]'::jsonb),

    'prospects', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'first_name', ucc.first_name,
        'last_name', ucc.last_name,
        'headline', ucc.headline,
        'email', ucc.email,
        'email_status', ucc.email_status,
        'linkedin_url', ucc.linkedin_url,
        'mobile_phone', ucc.mobile_phone,
        'phone', ucc.phone,
        'seniority', ucc.seniority,
        'is_decision_maker', ucc.is_decision_maker,
        'departments', ucc.departments
      ) ORDER BY ucc.is_decision_maker DESC NULLS LAST, ucc.seniority)
      FROM user_company_contacts ucc
      WHERE ucc.company_id = v_company_id AND ucc.user_id = p_user_id
    ), '[]'::jsonb),

    'news', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'title', cn.title,
        'url', cn.source_url,
        'published_at', cn.published_at,
        'source', cn.source_name
      ) ORDER BY cn.published_at DESC NULLS LAST)
      FROM company_news cn
      WHERE cn.company_id = v_company_id
      LIMIT 10
    ), '[]'::jsonb),

    'implementations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_name', ci.technology,
        'vendor_name', ci.provider_name,
        'category', ci.area,
        'source_url', ci.source_url
      ))
      FROM company_implementations ci
      WHERE ci.company_id = v_company_id
    ), '[]'::jsonb)

  ) INTO v_result;

  RETURN v_result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_companies_for_export(p_country text DEFAULT NULL::text, p_sort_by text DEFAULT 'signals'::text, p_limit integer DEFAULT 100, p_only_without_linkedin boolean DEFAULT false, p_only_without_industry boolean DEFAULT false, p_min_signals integer DEFAULT 0)
 RETURNS TABLE(name text, country text, linkedin_url text, website text, signal_count_process bigint, signal_count_technology bigint, job_posting_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  WITH company_signals AS (
    SELECT 
      s.company_id,
      COUNT(*) FILTER (WHERE s.signal_type = 'process') as process_count,
      COUNT(*) FILTER (WHERE s.signal_type = 'technology') as tech_count,
      COUNT(DISTINCT s.job_posting_id) FILTER (WHERE s.job_posting_id IS NOT NULL) as jp_count
    FROM signals s
    GROUP BY s.company_id
  )
  SELECT 
    c.name,
    c.country_normalized as country,
    c.linkedin_url,
    c.website,
    COALESCE(cs.process_count, 0) as signal_count_process,
    COALESCE(cs.tech_count, 0) as signal_count_technology,
    COALESCE(cs.jp_count, 0) as job_posting_count
  FROM companies c
  LEFT JOIN company_signals cs ON cs.company_id = c.id
  WHERE 
    -- Filtro por país
    (p_country IS NULL OR c.country_normalized = p_country)
    -- Filtro por LinkedIn
    AND (NOT p_only_without_linkedin OR c.linkedin_url IS NULL OR c.linkedin_url = '')
    -- Filtro por industria
    AND (NOT p_only_without_industry OR c.industry IS NULL OR c.industry = '')
    -- Filtro por mínimo de señales
    AND (p_min_signals = 0 OR COALESCE(cs.process_count, 0) + COALESCE(cs.tech_count, 0) >= p_min_signals)
  ORDER BY 
    CASE 
      WHEN p_sort_by = 'signals' THEN COALESCE(cs.process_count, 0) + COALESCE(cs.tech_count, 0)
      WHEN p_sort_by = 'contacts' THEN COALESCE(cs.process_count, 0) + COALESCE(cs.tech_count, 0) -- Fallback
      WHEN p_sort_by = 'job_postings' THEN COALESCE(cs.jp_count, 0)
      ELSE COALESCE(cs.process_count, 0) + COALESCE(cs.tech_count, 0)
    END DESC,
    CASE 
      WHEN p_sort_by = 'signals_asc' THEN COALESCE(cs.process_count, 0) + COALESCE(cs.tech_count, 0)
      ELSE 0
    END ASC,
    CASE 
      WHEN p_sort_by = 'no_linkedin' THEN 
        CASE WHEN c.linkedin_url IS NULL OR c.linkedin_url = '' THEN 0 ELSE 1 END
      ELSE 0
    END ASC,
    c.name
  LIMIT p_limit;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_company_drawer_data(p_company_id uuid, p_filter_signal_ids uuid[] DEFAULT NULL::uuid[], p_filter_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_result JSONB;
  v_company JSONB;
  v_dictionary_names TEXT[];
  v_signals JSONB;
  v_contacts JSONB;
  v_job_postings JSONB;
  v_alumni_signals JSONB;
  v_six_months_ago TIMESTAMPTZ;
BEGIN
  v_six_months_ago := NOW() - INTERVAL '6 months';

  -- 1. Company
  SELECT to_jsonb(c.*) INTO v_company
  FROM companies c
  WHERE c.id = p_company_id;

  -- 2. Dictionary names
  IF p_filter_signal_ids IS NOT NULL AND array_length(p_filter_signal_ids, 1) > 0 AND p_filter_type IS NOT NULL THEN
    IF p_filter_type = 'process' THEN
      SELECT array_agg(name) INTO v_dictionary_names
      FROM dictionary_processes
      WHERE id = ANY(p_filter_signal_ids);
    ELSE
      SELECT array_agg(name) INTO v_dictionary_names
      FROM dictionary_products
      WHERE id = ANY(p_filter_signal_ids);
    END IF;
  END IF;

  -- 3. Current employee signals
  SELECT COALESCE(jsonb_agg(signal_data ORDER BY signal_data->>'contact_name'), '[]'::jsonb) INTO v_signals
  FROM (
    SELECT jsonb_build_object(
      'id', s.id,
      'contact_id', s.contact_id,
      'company_id', s.company_id,
      'signal_id', s.signal_id,
      'signal_type', s.signal_type,
      'keyword_matched', s.keyword_matched,
      'source_field', s.source_field,
      'snippet', s.snippet,
      'source_url', s.source_url,
      'is_current_employee', s.is_current_employee,
      'created_at', s.created_at,
      'signal_name', COALESCE(dp.name, dpr.name, s.keyword_matched),
      'contact', jsonb_build_object(
        'id', ct.id,
        'full_name', ct.full_name,
        'headline', ct.headline,
        'linkedin_url', ct.linkedin_url,
        'profile_picture_url', ct.profile_picture_url,
        'current_position_title', ct.current_position_title,
        'current_company_id', ct.current_company_id,
        'email1', ct.email1,
        'email1_type', ct.email1_type,
        'email1_status', ct.email1_status,
        'email2', ct.email2,
        'email2_type', ct.email2_type,
        'email2_status', ct.email2_status,
        'phone1', ct.phone1,
        'phone1_type', ct.phone1_type,
        'phone2', ct.phone2,
        'phone2_type', ct.phone2_type,
        'previous_positions', ct.previous_positions
      ),
      'contact_name', ct.full_name
    ) AS signal_data
    FROM signals s
    LEFT JOIN contacts ct ON ct.id = s.contact_id
    LEFT JOIN dictionary_products dp ON dp.id = s.signal_id AND s.signal_type = 'technology'
    LEFT JOIN dictionary_processes dpr ON dpr.id = s.signal_id AND s.signal_type = 'process'
    WHERE s.company_id = p_company_id
      AND s.is_current_employee = TRUE
      AND (
        s.contact_id IS NOT NULL
        OR s.job_posted_at >= v_six_months_ago
      )
      AND (
        p_filter_signal_ids IS NULL
        OR array_length(p_filter_signal_ids, 1) = 0
        OR s.signal_id = ANY(p_filter_signal_ids)
      )
    LIMIT 200
  ) subq;

  -- 4. Contacts with signal counts
  SELECT COALESCE(jsonb_agg(contact_data ORDER BY contact_data->>'full_name'), '[]'::jsonb) INTO v_contacts
  FROM (
    SELECT jsonb_build_object(
      'id', ct.id,
      'full_name', ct.full_name,
      'headline', ct.headline,
      'linkedin_url', ct.linkedin_url,
      'profile_picture_url', ct.profile_picture_url,
      'current_position_title', ct.current_position_title,
      'email1', ct.email1,
      'email1_type', ct.email1_type,
      'email1_status', ct.email1_status,
      'email2', ct.email2,
      'email2_type', ct.email2_type,
      'email2_status', ct.email2_status,
      'phone1', ct.phone1,
      'phone1_type', ct.phone1_type,
      'phone2', ct.phone2,
      'phone2_type', ct.phone2_type,
      'signal_count', (
        SELECT COUNT(*)::int
        FROM signals s2
        WHERE s2.contact_id = ct.id
          AND (
            p_filter_signal_ids IS NULL
            OR array_length(p_filter_signal_ids, 1) = 0
            OR s2.signal_id = ANY(p_filter_signal_ids)
          )
      )
    ) AS contact_data
    FROM contacts ct
    WHERE ct.current_company_id = p_company_id
      AND (
        p_filter_signal_ids IS NULL
        OR array_length(p_filter_signal_ids, 1) = 0
        OR EXISTS (
          SELECT 1 FROM signals s3
          WHERE s3.contact_id = ct.id
            AND s3.signal_id = ANY(p_filter_signal_ids)
        )
      )
  ) subq
  WHERE (contact_data->>'signal_count')::int > 0
     OR p_filter_signal_ids IS NULL
     OR array_length(p_filter_signal_ids, 1) = 0;

  -- 5. Job postings (FIX 160: agregar jp.job_url al fallback de apply_url)
  SELECT COALESCE(jsonb_agg(jp_data ORDER BY jp_data->>'posted_at' DESC), '[]'::jsonb) INTO v_job_postings
  FROM (
    SELECT DISTINCT ON (jp.id) jsonb_build_object(
      'id', jp.id,
      'title', jp.title,
      'posted_at', jp.posted_at,
      'apply_url', COALESCE(jp.apply_url, jp.job_url, s.source_url),
      'keyword_matched', s.keyword_matched,
      'signal_name', COALESCE(dp.name, dpr.name, s.keyword_matched),
      'snippet', s.snippet
    ) AS jp_data
    FROM signals s
    JOIN job_postings jp ON jp.id = s.job_posting_id
    LEFT JOIN dictionary_products dp ON dp.id = s.signal_id AND s.signal_type = 'technology'
    LEFT JOIN dictionary_processes dpr ON dpr.id = s.signal_id AND s.signal_type = 'process'
    WHERE s.company_id = p_company_id
      AND s.job_posting_id IS NOT NULL
      AND jp.posted_at >= v_six_months_ago
      AND (
        p_filter_signal_ids IS NULL
        OR array_length(p_filter_signal_ids, 1) = 0
        OR s.signal_id = ANY(p_filter_signal_ids)
      )
  ) subq;

  -- 6. Alumni signals (sin cambios respecto a 104)
  SELECT COALESCE(jsonb_agg(alumni_signal_data ORDER BY alumni_signal_data->>'contact_name'), '[]'::jsonb) INTO v_alumni_signals
  FROM (
    SELECT jsonb_build_object(
      'id', s.id,
      'contact_id', s.contact_id,
      'company_id', s.company_id,
      'signal_id', s.signal_id,
      'signal_type', s.signal_type,
      'keyword_matched', s.keyword_matched,
      'source_field', s.source_field,
      'snippet', s.snippet,
      'source_url', s.source_url,
      'is_current_employee', s.is_current_employee,
      'created_at', s.created_at,
      'signal_name', COALESCE(dp.name, dpr.name, s.keyword_matched),
      'contact', jsonb_build_object(
        'id', ct.id,
        'full_name', ct.full_name,
        'headline', ct.headline,
        'linkedin_url', ct.linkedin_url,
        'profile_picture_url', ct.profile_picture_url,
        'current_position_title', ct.current_position_title,
        'current_company_id', ct.current_company_id,
        'email1', ct.email1,
        'email1_type', ct.email1_type,
        'email1_status', ct.email1_status,
        'email2', ct.email2,
        'email2_type', ct.email2_type,
        'email2_status', ct.email2_status,
        'phone1', ct.phone1,
        'phone1_type', ct.phone1_type,
        'phone2', ct.phone2,
        'phone2_type', ct.phone2_type,
        'previous_positions', ct.previous_positions
      ),
      'contact_name', ct.full_name
    ) AS alumni_signal_data
    FROM contacts ct
    CROSS JOIN LATERAL jsonb_array_elements(ct.previous_positions) AS pp
    JOIN signals s ON s.contact_id = ct.id
    LEFT JOIN dictionary_products dp ON dp.id = s.signal_id AND s.signal_type = 'technology'
    LEFT JOIN dictionary_processes dpr ON dpr.id = s.signal_id AND s.signal_type = 'process'
    WHERE (pp->>'company_id')::uuid = p_company_id
      AND ct.current_company_id IS DISTINCT FROM p_company_id
      AND s.company_id = p_company_id
      AND (
        p_filter_type IS NULL
        OR s.signal_type = p_filter_type
      )
      AND (
        p_filter_signal_ids IS NULL
        OR array_length(p_filter_signal_ids, 1) = 0
        OR s.signal_id = ANY(p_filter_signal_ids)
      )
    LIMIT 100
  ) subq;

  v_result := jsonb_build_object(
    'company', v_company,
    'dictionary_names', COALESCE(to_jsonb(v_dictionary_names), '[]'::jsonb),
    'signals', v_signals,
    'contacts', v_contacts,
    'job_postings', v_job_postings,
    'alumni_signals', v_alumni_signals
  );

  RETURN v_result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_company_job_postings(p_company_id uuid, p_signal_ids uuid[] DEFAULT NULL::uuid[], p_limit integer DEFAULT 100, p_location_filter text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, title text, location text, posted_at timestamp with time zone, apply_url text, detected_keywords jsonb, is_recent boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    jp.id,
    jp.title,
    jp.location,
    jp.posted_at,
    -- Fallback chain: apply_url -> job_url -> primer source_url de las signals
    COALESCE(jp.apply_url, jp.job_url, max_source_url.url) AS apply_url,
    jsonb_agg(
      DISTINCT jsonb_build_object(
        'keyword', s.keyword_matched,
        'signal_type', s.signal_type,
        'signal_name', COALESCE(dp.name, dpr.name, s.keyword_matched)
      )
    ) FILTER (WHERE s.id IS NOT NULL) AS detected_keywords,
    (jp.posted_at >= NOW() - INTERVAL '1 month') AS is_recent
  FROM signals s
  JOIN job_postings jp ON jp.id = s.job_posting_id
  LEFT JOIN dictionary_processes dp ON s.signal_id = dp.id AND s.signal_type = 'process'
  LEFT JOIN dictionary_products dpr ON s.signal_id = dpr.id AND s.signal_type = 'technology'
  LEFT JOIN LATERAL (
    SELECT s2.source_url AS url
    FROM signals s2
    WHERE s2.job_posting_id = jp.id AND s2.source_url IS NOT NULL
    LIMIT 1
  ) max_source_url ON true
  WHERE s.company_id = p_company_id
    AND s.job_posting_id IS NOT NULL
    AND (p_signal_ids IS NULL OR s.signal_id = ANY(p_signal_ids))
    AND jp.posted_at >= NOW() - INTERVAL '6 months'
    AND (
      p_location_filter IS NULL
      OR jp.location ILIKE '%' || p_location_filter || '%'
    )
  GROUP BY jp.id, jp.title, jp.location, jp.posted_at, jp.apply_url, jp.job_url, max_source_url.url
  ORDER BY jp.posted_at DESC
  LIMIT p_limit;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_company_signal_summary(p_company_id uuid)
 RETURNS TABLE(total_signals bigint, current_employees_with_signals bigint, alumni_with_tech_signals bigint, job_postings_count bigint, top_processes jsonb, top_technologies jsonb)
 LANGUAGE plpgsql
AS $function$
BEGIN
RETURN QUERY
WITH company_signals AS (
  SELECT
    s.*,
    COALESCE(dp.name, s.keyword_matched) as process_name,
    COALESCE(dprod.name, s.keyword_matched) as product_name
  FROM signals s
  LEFT JOIN dictionary_processes dp ON s.signal_id = dp.id AND s.signal_type = 'process'
  LEFT JOIN dictionary_products dprod ON s.signal_id = dprod.id AND s.signal_type = 'technology'
  WHERE s.company_id = p_company_id
),
job_postings_data AS (
  SELECT COUNT(DISTINCT jp.id) as jp_count
  FROM job_postings jp
  WHERE jp.company_id = p_company_id
)
SELECT
  COUNT(*) as total_signals,
  COUNT(DISTINCT CASE WHEN is_current_employee = true THEN contact_id END) as current_employees_with_signals,
  COUNT(DISTINCT CASE WHEN is_current_employee = false AND signal_type = 'technology' THEN contact_id END) as alumni_with_tech_signals,
  (SELECT jp_count FROM job_postings_data) as job_postings_count,
  -- Top 5 Processes (solo de empleados actuales)
  (
    SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
      SELECT process_name, COUNT(*) as count
      FROM company_signals
      WHERE signal_type = 'process' 
        AND is_current_employee = true
        AND process_name IS NOT NULL
        AND process_name != ''
      GROUP BY process_name
      ORDER BY count DESC
      LIMIT 5
    ) t
  ) as top_processes,
  -- Top 5 Technologies (current + alumni + job postings)
  (
    SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
      SELECT product_name, COUNT(*) as count
      FROM company_signals
      WHERE signal_type = 'technology'
        AND product_name IS NOT NULL
        AND product_name != ''
      GROUP BY product_name
      ORDER BY count DESC
      LIMIT 5
    ) t
  ) as top_technologies
FROM company_signals;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_cron_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'process_dictionary', (
      SELECT jsonb_build_object(
        'status', COALESCE(status, 'unknown'),
        'started_at', started_at,
        'completed_at', completed_at,
        'records_processed', records_processed,
        'error_message', error_message
      )
      FROM cron_executions
      WHERE cron_name = 'process-dictionary'
      ORDER BY started_at DESC
      LIMIT 1
    ),
    'process_queue', (
      SELECT jsonb_build_object(
        'status', COALESCE(status, 'unknown'),
        'started_at', started_at,
        'completed_at', completed_at,
        'records_processed', records_processed,
        'signals_created', signals_created,
        'error_message', error_message
      )
      FROM cron_executions
      WHERE cron_name = 'process-queue'
      ORDER BY started_at DESC
      LIMIT 1
    ),
    'monitor', (
      SELECT jsonb_build_object(
        'status', COALESCE(status, 'unknown'),
        'started_at', started_at,
        'completed_at', completed_at,
        'error_message', error_message
      )
      FROM cron_executions
      WHERE cron_name = 'monitor'
      ORDER BY started_at DESC
      LIMIT 1
    ),
    'sync_users', (
      SELECT jsonb_build_object(
        'status', COALESCE(status, 'unknown'),
        'started_at', started_at,
        'completed_at', completed_at,
        'records_processed', records_processed,
        'error_message', error_message
      )
      FROM cron_executions
      WHERE cron_name = 'sync-users'
      ORDER BY started_at DESC
      LIMIT 1
    )
  ) INTO result;
  
  RETURN result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_dashboard_counts()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'signals_total', (SELECT COUNT(*) FROM signals),
    'signals_process', (SELECT COUNT(*) FROM signals WHERE signal_type = 'process'),
    'signals_technology', (SELECT COUNT(*) FROM signals WHERE signal_type = 'technology'),
    'contacts_total', (SELECT COUNT(*) FROM contacts),
    'companies_total', (SELECT COUNT(*) FROM companies),
    'job_postings_total', (SELECT COUNT(*) FROM job_postings),
    'dictionary_processes', (SELECT COUNT(*) FROM dictionary_processes),
    'dictionary_products', (SELECT COUNT(*) FROM dictionary_products),
    'dictionary_vendors', (SELECT COUNT(*) FROM dictionary_vendors),
    'jobs_pending', (SELECT COUNT(*) FROM dictionary_jobs WHERE status = 'pending'),
    'jobs_processing', (SELECT COUNT(*) FROM dictionary_jobs WHERE status = 'processing'),
    'jobs_completed', (SELECT COUNT(*) FROM dictionary_jobs WHERE status = 'completed'),
    'jobs_failed', (SELECT COUNT(*) FROM dictionary_jobs WHERE status = 'failed'),
    'keywords_process', (SELECT COALESCE(SUM(array_length(keywords, 1)), 0) FROM dictionary_processes),
    'keywords_technology', (SELECT COALESCE(SUM(array_length(keywords, 1)), 0) FROM dictionary_products),
    'batches_pending', (SELECT COUNT(*) FROM import_batches WHERE status = 'pending'),
    'batches_processing', (SELECT COUNT(*) FROM import_batches WHERE status = 'processing'),
    'batches_completed', (SELECT COUNT(*) FROM import_batches WHERE status = 'completed'),
    'batches_failed', (SELECT COUNT(*) FROM import_batches WHERE status = 'failed')
  ) INTO result;
  
  RETURN result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_dictionary_jobs_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_pending INTEGER;
  v_processing INTEGER;
  v_recent JSONB;
BEGIN
  SELECT COUNT(*) INTO v_pending FROM public.dictionary_jobs WHERE status = 'pending';
  SELECT COUNT(*) INTO v_processing FROM public.dictionary_jobs WHERE status = 'processing';
  
  SELECT jsonb_agg(row_to_json(j))
  INTO v_recent
  FROM (
    SELECT id, job_type, signal_type, keyword, status, progress, 
           total_records, processed_records, created_at, completed_at, error_message
    FROM public.dictionary_jobs
    ORDER BY created_at DESC
    LIMIT 20
  ) j;
  
  RETURN jsonb_build_object(
    'pending_count', v_pending,
    'processing_count', v_processing,
    'recent_jobs', COALESCE(v_recent, '[]'::jsonb)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_distinct_industries()
 RETURNS TABLE(industry text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT DISTINCT c.industry 
  FROM companies c 
  WHERE c.industry IS NOT NULL AND c.industry != ''
  ORDER BY c.industry
  LIMIT 200;
$function$
;

CREATE OR REPLACE FUNCTION public.get_document_tag_counts()
 RETURNS TABLE(document_id uuid, tag_count bigint)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT document_id, COUNT(*) as tag_count
  FROM document_tags
  GROUP BY document_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_dup_candidates_summary()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'v3', 'pg_catalog'
AS $function$
  SELECT jsonb_build_object(
    'seguros_pendientes', count(*) FILTER (WHERE classification = 'seguro' AND status = 'pending'),
    'ambiguos_pendientes', count(*) FILTER (WHERE classification = 'ambiguo' AND status = 'pending'),
    'ia_misma',    count(*) FILTER (WHERE status = 'ai_same'),
    'ia_distinta', count(*) FILTER (WHERE status = 'ai_different'),
    'ia_dudosa',   count(*) FILTER (WHERE status = 'ai_unsure'),
    'mergeados',   count(*) FILTER (WHERE status = 'merged'),
    'fallidos',    count(*) FILTER (WHERE status = 'failed'),
    'reversibles', (SELECT count(*) FROM v3.company_merges WHERE reverted_at IS NULL),
    'costo_ia_usd',(SELECT coalesce(round(sum(cost_usd)::numeric, 4), 0)
                      FROM v3.ai_usage_log WHERE feature = 'dedupe')
  )
  FROM v3.company_dup_candidates;
$function$
;

CREATE OR REPLACE FUNCTION public.get_duplicate_candidates(p_limit integer DEFAULT 100)
 RETURNS TABLE(normalized_name text, count bigint, companies jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    c.normalized_name,
    COUNT(*) as count,
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'linkedin_url', c.linkedin_url,
        'website', c.website
      )
    ) as companies
  FROM companies c
  WHERE c.normalized_name IS NOT NULL 
    AND c.normalized_name != ''
    AND c.normalized_name != 'unknown company'  -- Excluir Unknown Company
  GROUP BY c.normalized_name
  HAVING COUNT(*) > 1
  ORDER BY COUNT(*) DESC
  LIMIT p_limit;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_duplicate_candidates_v2(p_limit integer DEFAULT 100, p_classification text DEFAULT NULL::text, p_status text DEFAULT 'pending'::text)
 RETURNS TABLE(id uuid, group_key text, method text, classification text, status text, master_id uuid, company_ids uuid[], companies jsonb, ai_confidence numeric, ai_reasoning text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'v3', 'pg_catalog'
AS $function$
  SELECT d.id, d.group_key, d.method, d.classification, d.status,
         d.master_id, d.company_ids, d.payload, d.ai_confidence, d.ai_reasoning
  FROM v3.company_dup_candidates d
  WHERE (p_status IS NULL OR d.status = p_status)
    AND (p_classification IS NULL OR d.classification = p_classification)
  ORDER BY
    CASE d.status WHEN 'ai_same' THEN 0 ELSE 1 END,
    d.ai_confidence DESC NULLS LAST,
    array_length(d.company_ids, 1) DESC
  LIMIT p_limit;
$function$
;

CREATE OR REPLACE FUNCTION public.get_export_stats()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'total_companies', (SELECT COUNT(*) FROM companies),
    'with_linkedin', (SELECT COUNT(*) FROM companies WHERE linkedin_url IS NOT NULL AND linkedin_url != ''),
    'with_website', (SELECT COUNT(*) FROM companies WHERE website IS NOT NULL AND website != ''),
    'with_industry', (SELECT COUNT(*) FROM companies WHERE industry IS NOT NULL AND industry != ''),
    'with_country', (SELECT COUNT(*) FROM companies WHERE country_normalized IS NOT NULL),
    'with_signals', (SELECT COUNT(DISTINCT company_id) FROM signals),
    'with_job_postings', (SELECT COUNT(DISTINCT s.company_id) FROM signals s WHERE s.job_posting_id IS NOT NULL)
  ) INTO v_result;
  
  RETURN v_result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_icebreaker_context(p_bookmark_id uuid, p_contact_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_user_id UUID;
  v_company_id UUID;
  v_result JSONB;
  v_company JSONB;
  v_contact JSONB;
  v_signals JSONB;
  v_job_postings JSONB;
  v_news JSONB;
  v_success_cases JSONB;
  v_strategy JSONB;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  -- Get company_id from bookmark (verify ownership)
  SELECT b.company_id INTO v_company_id
  FROM bookmarks b
  WHERE b.id = p_bookmark_id AND b.user_id = v_user_id;

  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Bookmark not found or not owned');
  END IF;

  -- =====================================================
  -- 1. COMPANY INFO
  -- =====================================================
  SELECT jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'industry', c.industry,
    'country', c.country,
    'website', c.website,
    'linkedin_url', c.linkedin_url
  ) INTO v_company
  FROM companies c
  WHERE c.id = v_company_id;

  -- =====================================================
  -- 2. CONTACT INFO (if provided)
  -- =====================================================
  IF p_contact_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', ct.id,
      'first_name', ct.first_name,
      'last_name', ct.last_name,
      'headline', ct.headline,
      'current_position_title', ct.current_position_title,
      'linkedin_url', ct.linkedin_url,
      'is_current_employee', EXISTS(
        SELECT 1 FROM signals s 
        WHERE s.contact_id = ct.id 
        AND s.company_id = v_company_id 
        AND s.is_current_employee = true
      )
    ) INTO v_contact
    FROM contacts ct
    WHERE ct.id = p_contact_id;
  ELSE
    v_contact := NULL;
  END IF;

  -- =====================================================
  -- 3. SIGNALS (technology/process signals for this company)
  -- =====================================================
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'keyword', s.keyword_matched,
      'signal_type', s.signal_type,
      'snippet', s.snippet,
      'source_field', s.source_field,
      'is_current_employee', s.is_current_employee,
      'vendor', dv.name,
      'product', dp.name,
      'process', dpr.name
    ) ORDER BY s.created_at DESC
  ), '[]'::jsonb) INTO v_signals
  FROM signals s
  LEFT JOIN dictionary_products dp ON LOWER(s.keyword_matched) = ANY(SELECT LOWER(k) FROM unnest(dp.keywords) k)
  LEFT JOIN dictionary_vendors dv ON dp.vendor_id = dv.id
  LEFT JOIN dictionary_processes dpr ON LOWER(s.keyword_matched) = ANY(SELECT LOWER(k) FROM unnest(dpr.keywords) k)
  WHERE s.company_id = v_company_id
  LIMIT 20;

  -- =====================================================
  -- 4. JOB POSTINGS (active positions)
  -- =====================================================
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'title', jp.title,
      'description_preview', LEFT(jp.description, 300),
      'location', jp.location,
      'seniority', jp.seniority,
      'posted_at', jp.posted_at
    ) ORDER BY jp.posted_at DESC NULLS LAST
  ), '[]'::jsonb) INTO v_job_postings
  FROM job_postings jp
  WHERE jp.company_id = v_company_id
  LIMIT 10;

  -- =====================================================
  -- 5. NEWS (user's collected news for this bookmark)
  -- =====================================================
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'title', cn.title,
      'summary', cn.summary,
      'source_name', cn.source_name,
      'published_at', cn.published_at,
      'relevance_tags', cn.relevance_tags
    ) ORDER BY cn.published_at DESC NULLS LAST
  ), '[]'::jsonb) INTO v_news
  FROM company_news cn
  WHERE cn.bookmark_id = p_bookmark_id
    AND cn.user_id = v_user_id
  LIMIT 10;

  -- =====================================================
  -- 6. SUCCESS CASES (user's cases, prioritizing relevant industry)
  -- =====================================================
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'title', sc.title,
      'client_industry', sc.client_industry,
      'client_size', sc.client_size,
      'challenge', sc.challenge,
      'solution', sc.solution,
      'results', sc.results,
      'technologies', sc.technologies,
      'is_relevant', sc.client_industry = (SELECT industry FROM companies WHERE id = v_company_id)
    ) ORDER BY 
      (sc.client_industry = (SELECT industry FROM companies WHERE id = v_company_id)) DESC,
      sc.created_at DESC
  ), '[]'::jsonb) INTO v_success_cases
  FROM success_cases sc
  WHERE sc.user_id = v_user_id
    AND sc.is_active = true
  LIMIT 10;

  -- =====================================================
  -- 7. STRATEGY (user's strategy for this bookmark)
  -- =====================================================
  SELECT jsonb_build_object(
    'target_summary', ucs.target_summary,
    'recommended_pitch', ucs.recommended_pitch,
    'sender_context', COALESCE(
      ucs.sender_context_override,
      (SELECT value_proposition FROM profiles WHERE id = v_user_id)
    )
  ) INTO v_strategy
  FROM user_company_strategies ucs
  WHERE ucs.bookmark_id = p_bookmark_id
    AND ucs.user_id = v_user_id;

  -- If no strategy exists, try to get default sender context from profile
  IF v_strategy IS NULL THEN
    SELECT jsonb_build_object(
      'target_summary', NULL,
      'recommended_pitch', NULL,
      'sender_context', p.value_proposition
    ) INTO v_strategy
    FROM profiles p
    WHERE p.id = v_user_id;
  END IF;

  -- =====================================================
  -- BUILD FINAL RESULT
  -- =====================================================
  v_result := jsonb_build_object(
    'company', v_company,
    'contact', v_contact,
    'signals', v_signals,
    'job_postings', v_job_postings,
    'news', v_news,
    'success_cases', v_success_cases,
    'strategy', v_strategy,
    'template_rules', jsonb_build_object(
      'always_start_with_name', true,
      'never_mention_job_title', true,
      'only_mention_process_if_explicit', true,
      'fallback_phrase', 'en sus operaciones'
    ),
    'generated_at', NOW()
  );

  RETURN v_result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_industry_counts_for_process(p_process_ids uuid[], p_countries text[], p_exclude_providers boolean DEFAULT false)
 RETURNS TABLE(master_industry_id text, name_es text, icon text, company_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    mi.id as master_industry_id,
    mi.name_es,
    mi.icon,
    COUNT(DISTINCT c.id) as company_count
  FROM signals s
  JOIN companies c ON s.company_id = c.id
  JOIN master_industries mi ON c.master_industry_id = mi.id
  WHERE s.signal_id = ANY(p_process_ids)
    AND s.signal_type = 'process'
    AND (p_countries IS NULL OR c.country = ANY(p_countries))
    AND (NOT p_exclude_providers OR c.is_service_provider IS NOT TRUE)
    AND c.master_industry_id IS NOT NULL
  GROUP BY mi.id, mi.name_es, mi.icon, mi.display_order
  HAVING COUNT(DISTINCT c.id) > 0
  ORDER BY mi.display_order;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_industry_counts_for_technology(p_product_id uuid, p_countries text[], p_exclude_providers boolean DEFAULT false)
 RETURNS TABLE(master_industry_id text, name_es text, icon text, company_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    mi.id as master_industry_id,
    mi.name_es,
    mi.icon,
    COUNT(DISTINCT c.id) as company_count
  FROM signals s
  JOIN companies c ON s.company_id = c.id
  JOIN master_industries mi ON c.master_industry_id = mi.id
  WHERE s.signal_id = p_product_id
    AND s.signal_type = 'technology'
    AND (p_countries IS NULL OR c.country = ANY(p_countries))
    AND (NOT p_exclude_providers OR c.is_service_provider IS NOT TRUE)
    AND c.master_industry_id IS NOT NULL
  GROUP BY mi.id, mi.name_es, mi.icon, mi.display_order
  HAVING COUNT(DISTINCT c.id) > 0
  ORDER BY mi.display_order;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_pending_dictionary_jobs(p_limit integer DEFAULT 10)
 RETURNS SETOF dictionary_jobs
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT * FROM public.dictionary_jobs 
  WHERE status IN ('pending', 'processing')
  ORDER BY created_at ASC
  LIMIT p_limit;
$function$
;

CREATE OR REPLACE FUNCTION public.get_processing_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_pending_count INTEGER;
  v_signals_count INTEGER;
  v_processing_batches INTEGER;
BEGIN
  -- Count pending import_rows
  SELECT COUNT(*) INTO v_pending_count 
  FROM public.import_rows 
  WHERE status = 'pending';
  
  -- Count total signals (using approximate count for performance)
  SELECT reltuples::bigint INTO v_signals_count
  FROM pg_class
  WHERE relname = 'signals';
  
  -- Count processing batches
  SELECT COUNT(*) INTO v_processing_batches 
  FROM public.import_batches 
  WHERE status = 'processing';
  
  RETURN jsonb_build_object(
    'pending', v_pending_count,
    'signals', v_signals_count,
    'processing_batches', v_processing_batches
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_prospects_for_icebreakers(p_bookmark_id uuid, p_user_id uuid)
 RETURNS TABLE(id uuid, full_name text, first_name text, role text, headline text, linkedin_url text, email text, email_status text, phone text, profile_picture_url text, source text, is_decision_maker boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    ucc.id,
    ucc.full_name,
    ucc.first_name,
    ucc.role,
    ucc.headline,
    ucc.linkedin_url,
    ucc.email,
    ucc.email_status,
    COALESCE(ucc.mobile_phone, ucc.phone) as phone,
    ucc.profile_picture_url,
    ucc.source,
    ucc.is_decision_maker
  FROM public.user_company_contacts ucc
  WHERE ucc.bookmark_id = p_bookmark_id
    AND ucc.user_id = p_user_id
    AND ucc.is_decision_maker = true
  ORDER BY ucc.created_at DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_recent_company_merges(p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, master_id uuid, master_name text, duplicate_name text, method text, confidence numeric, reasoning text, rows_moved integer, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'v3', 'pg_catalog'
AS $function$
  SELECT m.id, m.master_id, c.name, m.duplicate_snapshot->>'name',
         m.method, m.confidence, m.reasoning,
         (SELECT coalesce(sum(jsonb_array_length(value)), 0)::int FROM jsonb_each(m.moved)),
         m.created_at
  FROM v3.company_merges m
  LEFT JOIN public.companies c ON c.id = m.master_id
  WHERE m.reverted_at IS NULL
  ORDER BY m.created_at DESC LIMIT p_limit;
$function$
;

CREATE OR REPLACE FUNCTION public.get_unmapped_company_industries()
 RETURNS TABLE(industry text, count bigint)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT 
    c.industry,
    COUNT(*) as count
  FROM companies c
  LEFT JOIN industry_mappings im 
    ON LOWER(TRIM(c.industry)) = LOWER(TRIM(im.original_value)) 
    AND im.source_type = 'company'
  WHERE c.industry IS NOT NULL 
    AND c.industry != ''
    AND c.master_industry_id IS NULL
    AND im.id IS NULL
  GROUP BY c.industry
  ORDER BY count DESC
  LIMIT 100;
$function$
;

CREATE OR REPLACE FUNCTION public.get_unmapped_document_industries()
 RETURNS TABLE(tag_value text, count bigint)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT 
    dt.tag_value,
    COUNT(*) as count
  FROM document_tags dt
  LEFT JOIN industry_mappings im 
    ON LOWER(TRIM(dt.tag_value)) = LOWER(TRIM(im.original_value)) 
    AND im.source_type = 'document'
  WHERE dt.tag_type = 'industry'
    AND dt.master_industry_id IS NULL
    AND im.id IS NULL
  GROUP BY dt.tag_value
  ORDER BY count DESC
  LIMIT 100;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_usage_stats()
 RETURNS TABLE(user_id uuid, user_email text, total_bookmarks bigint, high_priority bigint, medium_priority bigint, low_priority bigint, no_priority bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT 
    b.user_id,
    COALESCE(u.email::TEXT, 'Sin email'::TEXT) as user_email,
    COUNT(b.id)::BIGINT as total_bookmarks,
    COUNT(CASE WHEN b.priority = 'alta' THEN 1 END)::BIGINT as high_priority,
    COUNT(CASE WHEN b.priority = 'media' THEN 1 END)::BIGINT as medium_priority,
    COUNT(CASE WHEN b.priority = 'baja' THEN 1 END)::BIGINT as low_priority,
    COUNT(CASE WHEN b.priority IS NULL OR b.priority NOT IN ('alta', 'media', 'baja') THEN 1 END)::BIGINT as no_priority
  FROM bookmarks b
  LEFT JOIN auth.users u ON u.id = b.user_id
  GROUP BY b.user_id, u.email
  ORDER BY COUNT(b.id) DESC;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  user_role TEXT;
BEGIN
  -- Check if email ends with @bigua.lat to assign superadmin role
  IF new.email LIKE '%@bigua.lat' THEN
    user_role := 'superadmin';
  ELSE
    user_role := 'user';
  END IF;
  
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', user_role);
  RETURN new;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user_onboarding()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.user_onboarding (user_id, status)
  VALUES (NEW.id, 'pending')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.increment_batch_failures(p_batch_id uuid, p_error text)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE import_batches
  SET consecutive_failures = consecutive_failures + 1,
      last_error = p_error,
      updated_at = timezone('utc'::text, now())
  WHERE id = p_batch_id
  RETURNING consecutive_failures;
$function$
;

CREATE OR REPLACE FUNCTION public.is_personal_email(p_email text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_email is null or position('@' in p_email) = 0 then false
    else lower(split_part(p_email, '@', 2)) in (
      'gmail.com',
      'googlemail.com',
      'hotmail.com',
      'hotmail.es',
      'hotmail.com.ar',
      'outlook.com',
      'outlook.es',
      'live.com',
      'live.com.ar',
      'msn.com',
      'yahoo.com',
      'yahoo.es',
      'yahoo.com.ar',
      'ymail.com',
      'icloud.com',
      'me.com',
      'mac.com',
      'aol.com',
      'proton.me',
      'protonmail.com',
      'pm.me',
      'gmx.com',
      'gmx.net',
      'mail.com',
      'yandex.com',
      'yandex.ru',
      'zoho.com',
      'fastmail.com',
      'tutanota.com',
      'hey.com'
    )
  end
$function$
;

CREATE OR REPLACE FUNCTION public.is_superadmin()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
    AND role = 'superadmin'
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.merge_companies(p_master_company_id uuid, p_duplicate_company_id uuid, p_dry_run boolean DEFAULT false, p_method text DEFAULT 'manual'::text, p_confidence numeric DEFAULT NULL::numeric, p_reasoning text DEFAULT NULL::text, p_decided_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'v3', 'pg_catalog'
AS $function$
DECLARE
  v_snapshot   JSONB;
  v_child      RECORD;
  v_tbl        TEXT;
  v_col        TEXT;
  v_moved      JSONB := '{}'::jsonb;
  v_deleted    JSONB := '{}'::jsonb;
  v_cascade    JSONB := '[]'::jsonb;
  v_follow     JSONB := '[]'::jsonb;
  v_bookmarks  JSONB := '[]'::jsonb;
  v_tiene_cascada BOOLEAN;
  v_ids        JSONB;
  v_rows       JSONB;
  v_row        JSONB;
  v_row_id     UUID;
  v_merge_id   UUID;
  v_result     JSONB;
  v_conflicts  UUID[];   -- [423]
BEGIN
  IF p_master_company_id IS NULL OR p_duplicate_company_id IS NULL THEN
    RAISE EXCEPTION 'merge_companies: los ids no pueden ser NULL';
  END IF;

  IF p_master_company_id = p_duplicate_company_id THEN
    RAISE EXCEPTION 'merge_companies: master y duplicada son la misma fila (%)',
      p_master_company_id;
  END IF;

  SELECT to_jsonb(c) INTO v_snapshot
  FROM public.companies c WHERE c.id = p_duplicate_company_id;

  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'merge_companies: no existe la empresa duplicada %',
      p_duplicate_company_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_master_company_id) THEN
    RAISE EXCEPTION 'merge_companies: no existe la empresa master %',
      p_master_company_id;
  END IF;

  BEGIN
    v_follow := v3.premerge_followed_accounts(p_master_company_id, p_duplicate_company_id);
    v_bookmarks := v3.premerge_bookmarks(p_master_company_id, p_duplicate_company_id);

    FOR v_child IN
      SELECT (con.conrelid::regclass)::text AS tbl, a.attname AS col
      FROM pg_constraint con
      JOIN pg_attribute a
        ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
      WHERE con.contype = 'f'
        AND con.confrelid = 'public.companies'::regclass
        AND array_length(con.conkey, 1) = 1
      ORDER BY 1
    LOOP
      v_tbl := v_child.tbl;
      v_col := v_child.col;

      BEGIN
        EXECUTE format(
          'WITH upd AS (UPDATE %s SET %I = $1 WHERE %I = $2 RETURNING id)
           SELECT coalesce(jsonb_agg(id), ''[]''::jsonb) FROM upd',
          v_tbl, v_col, v_col
        ) INTO v_ids USING p_master_company_id, p_duplicate_company_id;

      EXCEPTION WHEN unique_violation THEN
        -- [423] Antes esto se iba fila por fila sobre TODA la tabla, con una
        -- subtransaccion por fila. Ahora se resuelven los conflictos en bloque
        -- y se reintenta el UPDATE masivo.
        v_ids  := '[]'::jsonb;
        v_rows := '[]'::jsonb;

        -- snapshot_cascade cuesta ~9ms por llamada (consulta pg_constraint y
        -- recursa), asi que se resuelve UNA VEZ por tabla. Solo 5 tablas tienen
        -- hijos en cascada; el resto no paga nada.
        SELECT EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE contype = 'f'
             AND confrelid = v_tbl::regclass
             AND confdeltype = 'c'
             AND conrelid <> v_tbl::regclass
        ) INTO v_tiene_cascada;

        v_conflicts := v3.child_conflict_ids(
          v_tbl, v_col, p_master_company_id, p_duplicate_company_id
        );

        IF array_length(v_conflicts, 1) > 0 THEN
          -- Guardar lo que se va a ir en cascada ANTES de borrar. Un solo
          -- llamado para todas las filas en conflicto.
          IF v_tiene_cascada THEN
            v_cascade := v_cascade || v3.snapshot_cascade(v_tbl, v_conflicts);
          END IF;

          EXECUTE format(
            'WITH del AS (DELETE FROM %s WHERE id = ANY($1) RETURNING *)
             SELECT coalesce(jsonb_agg(to_jsonb(del)), ''[]''::jsonb) FROM del',
            v_tbl
          ) INTO v_rows USING v_conflicts;
        END IF;

        BEGIN
          EXECUTE format(
            'WITH upd AS (UPDATE %s SET %I = $1 WHERE %I = $2 RETURNING id)
             SELECT coalesce(jsonb_agg(id), ''[]''::jsonb) FROM upd',
            v_tbl, v_col, v_col
          ) INTO v_ids USING p_master_company_id, p_duplicate_company_id;

        EXCEPTION WHEN unique_violation THEN
          -- Ultima red: la deteccion en conjunto no cubrio algun indice (por
          -- ejemplo uno con expresiones). Se vuelve al camino lento, que es
          -- correcto aunque cueste. Preferimos lento antes que incorrecto.
          v_ids := '[]'::jsonb;

          FOR v_row_id IN
            EXECUTE format('SELECT id FROM %s WHERE %I = $1', v_tbl, v_col)
            USING p_duplicate_company_id
          LOOP
            BEGIN
              EXECUTE format('UPDATE %s SET %I = $1 WHERE id = $2', v_tbl, v_col)
                USING p_master_company_id, v_row_id;
              v_ids := v_ids || to_jsonb(v_row_id);
            EXCEPTION WHEN unique_violation THEN
              IF v_tiene_cascada THEN
                v_cascade := v_cascade || v3.snapshot_cascade(v_tbl, ARRAY[v_row_id]);
              END IF;

              EXECUTE format(
                'WITH del AS (DELETE FROM %s WHERE id = $1 RETURNING *)
                 SELECT coalesce(jsonb_agg(to_jsonb(del)), ''[]''::jsonb) FROM del',
                v_tbl
              ) INTO v_row USING v_row_id;
              v_rows := v_rows || v_row;
            END;
          END LOOP;
        END;

        IF jsonb_array_length(v_rows) > 0 THEN
          v_deleted := v_deleted || jsonb_build_object(v_tbl, v_rows);
        END IF;
      END;

      IF jsonb_array_length(v_ids) > 0 THEN
        v_moved := v_moved || jsonb_build_object(v_tbl, v_ids);
      END IF;
    END LOOP;

    DELETE FROM public.companies WHERE id = p_duplicate_company_id;

    UPDATE public.companies m SET
      linkedin_url           = coalesce(m.linkedin_url,           v_snapshot->>'linkedin_url'),
      linkedin_slug          = coalesce(m.linkedin_slug,          v_snapshot->>'linkedin_slug'),
      website                = coalesce(m.website,                v_snapshot->>'website'),
      industry               = coalesce(m.industry,               v_snapshot->>'industry'),
      country                = coalesce(nullif(m.country, ''),    nullif(v_snapshot->>'country', '')),
      country_normalized     = coalesce(m.country_normalized,     v_snapshot->>'country_normalized'),
      logo_url               = coalesce(m.logo_url,               v_snapshot->>'logo_url'),
      description            = coalesce(m.description,            v_snapshot->>'description'),
      ticker                 = coalesce(m.ticker,                 v_snapshot->>'ticker'),
      cik                    = coalesce(m.cik,                    v_snapshot->>'cik'),
      stock_exchange         = coalesce(m.stock_exchange,         v_snapshot->>'stock_exchange'),
      apollo_organization_id = coalesce(m.apollo_organization_id, v_snapshot->>'apollo_organization_id'),
      apollo_industry        = coalesce(m.apollo_industry,        v_snapshot->>'apollo_industry'),
      updated_at             = now()
    WHERE m.id = p_master_company_id;

    INSERT INTO v3.company_merges (
      master_id, duplicate_id, duplicate_snapshot, moved, deleted,
      cascade_deleted, follow_merge, bookmark_merge,
      method, confidence, reasoning, decided_by
    ) VALUES (
      p_master_company_id, p_duplicate_company_id, v_snapshot, v_moved, v_deleted,
      v_cascade, v_follow, v_bookmarks,
      p_method, p_confidence, p_reasoning, p_decided_by
    )
    RETURNING id INTO v_merge_id;

    v_result := jsonb_build_object(
      'dry_run',        p_dry_run,
      'merge_id',       v_merge_id,
      'master_id',      p_master_company_id,
      'duplicate_id',   p_duplicate_company_id,
      'duplicate_name', v_snapshot->>'name',
      'moved',          v_moved,
      'deleted',        v_deleted,
      'cascade_deleted', v_cascade,
      'follow_merge',   v_follow,
      'bookmark_merge', v_bookmarks,
      'bookmarks_consolidados', jsonb_array_length(v_bookmarks),
      'moved_total',    (SELECT coalesce(sum(jsonb_array_length(value)), 0)
                         FROM jsonb_each(v_moved)),
      'deleted_total',  (SELECT coalesce(sum(jsonb_array_length(value)), 0)
                         FROM jsonb_each(v_deleted)),
      'cascade_total',  (SELECT coalesce(sum(jsonb_array_length(e->'rows')), 0)
                         FROM jsonb_array_elements(v_cascade) e)
    );

    IF p_dry_run THEN
      RAISE EXCEPTION 'dry run' USING ERRCODE = 'YY001';
    END IF;

  EXCEPTION WHEN SQLSTATE 'YY001' THEN
    v_result := v_result || jsonb_build_object('merge_id', NULL, 'applied', false);
  END;

  RETURN coalesce(v_result, '{}'::jsonb) ||
         jsonb_build_object('applied', NOT p_dry_run);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.names_are_similar(p_name1 text, p_name2 text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_words1 TEXT[];
  v_words2 TEXT[];
  v_common_words INT := 0;
  v_word TEXT;
BEGIN
  IF p_name1 IS NULL OR p_name2 IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Si son exactamente iguales (case insensitive)
  IF LOWER(TRIM(p_name1)) = LOWER(TRIM(p_name2)) THEN
    RETURN TRUE;
  END IF;
  
  -- Dividir en palabras (solo palabras de 3+ caracteres para evitar ruido)
  SELECT array_agg(word) INTO v_words1 
  FROM (SELECT unnest(regexp_split_to_array(LOWER(p_name1), '\s+')) AS word) t 
  WHERE length(word) >= 3;
  
  SELECT array_agg(word) INTO v_words2 
  FROM (SELECT unnest(regexp_split_to_array(LOWER(p_name2), '\s+')) AS word) t 
  WHERE length(word) >= 3;
  
  -- Si alguno no tiene palabras significativas, comparar si uno contiene al otro
  IF v_words1 IS NULL OR v_words2 IS NULL THEN
    RETURN LOWER(p_name1) LIKE '%' || LOWER(p_name2) || '%'
        OR LOWER(p_name2) LIKE '%' || LOWER(p_name1) || '%';
  END IF;
  
  -- Contar palabras en común
  FOREACH v_word IN ARRAY v_words1
  LOOP
    IF v_word = ANY(v_words2) THEN
      v_common_words := v_common_words + 1;
    END IF;
  END LOOP;
  
  -- Si tienen al menos 1 palabra significativa en común, son similares
  RETURN v_common_words >= 1;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_company_industry()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Solo procesar si hay industria
  IF NEW.industry IS NOT NULL AND NEW.industry != '' THEN
    -- Buscar mapeo existente (case insensitive)
    SELECT master_industry_id INTO NEW.master_industry_id
    FROM industry_mappings
    WHERE LOWER(original_value) = LOWER(NEW.industry)
      AND source_type = 'company';
  ELSE
    NEW.master_industry_id := NULL;
  END IF;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_company_name(p_name text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_normalized TEXT;
BEGIN
  IF p_name IS NULL OR TRIM(p_name) = '' THEN
    RETURN NULL;
  END IF;
  
  v_normalized := TRIM(p_name);
  
  -- 1. Si hay "/" o "|", tomar solo la primera parte
  IF v_normalized ~ '[/|]' THEN
    v_normalized := TRIM(split_part(v_normalized, '/', 1));
    v_normalized := TRIM(split_part(v_normalized, '|', 1));
  END IF;
  
  -- 2. Convertir a minúsculas
  v_normalized := LOWER(v_normalized);
  
  -- 3. Remover acentos (é->e, ñ->n, etc.)
  v_normalized := unaccent(v_normalized);
  
  -- 4. Eliminar puntuación al final
  v_normalized := regexp_replace(v_normalized, '[.,]+$', '');
  
  -- 5. Eliminar sufijos corporativos comunes
  v_normalized := regexp_replace(v_normalized, '\s+(s\.?a\.?|s\.?r\.?l\.?|s\.?a\.?s\.?|inc\.?|corp\.?|ltd\.?|llc\.?|gmbh|plc|pty|co\.?)$', '', 'i');
  
  -- 6. Eliminar sufijos de grupo/holding
  v_normalized := regexp_replace(v_normalized, '\s+(group|grupo|holdings?|international|intl\.?)$', '', 'i');
  
  -- 7. Normalizar espacios múltiples
  v_normalized := regexp_replace(v_normalized, '\s+', ' ', 'g');
  
  -- 8. Trim final
  v_normalized := TRIM(v_normalized);
  
  RETURN v_normalized;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_contact_country_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.country IS DISTINCT FROM OLD.country OR TG_OP = 'INSERT' THEN
    NEW.country_normalized := normalize_country(NEW.country);
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_country(p_country text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  clean_country TEXT;
  result TEXT;
  parts TEXT[];
  last_part TEXT;
BEGIN
  IF p_country IS NULL OR btrim(p_country) = '' THEN
    RETURN NULL;
  END IF;

  clean_country := btrim(p_country);

  result := CASE lower(clean_country)
    -- LATAM
    WHEN 'argentina' THEN 'Argentina'
    WHEN 'argentine' THEN 'Argentina'
    WHEN 'ar' THEN 'Argentina'
    WHEN 'chile' THEN 'Chile'
    WHEN 'cl' THEN 'Chile'
    WHEN 'mexico' THEN 'Mexico'
    WHEN 'méxico' THEN 'Mexico'
    WHEN 'mx' THEN 'Mexico'
    WHEN 'colombia' THEN 'Colombia'
    WHEN 'co' THEN 'Colombia'
    WHEN 'peru' THEN 'Peru'
    WHEN 'perú' THEN 'Peru'
    WHEN 'pe' THEN 'Peru'
    WHEN 'brazil' THEN 'Brazil'
    WHEN 'brasil' THEN 'Brazil'
    WHEN 'br' THEN 'Brazil'
    WHEN 'ecuador' THEN 'Ecuador'
    WHEN 'ec' THEN 'Ecuador'
    WHEN 'uruguay' THEN 'Uruguay'
    WHEN 'uy' THEN 'Uruguay'
    WHEN 'paraguay' THEN 'Paraguay'
    WHEN 'py' THEN 'Paraguay'
    WHEN 'bolivia' THEN 'Bolivia'
    WHEN 'bo' THEN 'Bolivia'
    WHEN 'venezuela' THEN 'Venezuela'
    WHEN 've' THEN 'Venezuela'
    WHEN 'costa rica' THEN 'Costa Rica'
    WHEN 'cr' THEN 'Costa Rica'
    WHEN 'panama' THEN 'Panama'
    WHEN 'panamá' THEN 'Panama'
    WHEN 'pa' THEN 'Panama'
    WHEN 'guatemala' THEN 'Guatemala'
    WHEN 'gt' THEN 'Guatemala'
    WHEN 'honduras' THEN 'Honduras'
    WHEN 'hn' THEN 'Honduras'
    WHEN 'el salvador' THEN 'El Salvador'
    WHEN 'sv' THEN 'El Salvador'
    WHEN 'nicaragua' THEN 'Nicaragua'
    WHEN 'ni' THEN 'Nicaragua'
    WHEN 'puerto rico' THEN 'Puerto Rico'
    WHEN 'pr' THEN 'Puerto Rico'
    WHEN 'dominican republic' THEN 'Dominican Republic'
    WHEN 'república dominicana' THEN 'Dominican Republic'
    WHEN 'do' THEN 'Dominican Republic'
    WHEN 'cuba' THEN 'Cuba'
    WHEN 'cu' THEN 'Cuba'

    -- Europe
    WHEN 'spain' THEN 'Spain'
    WHEN 'españa' THEN 'Spain'
    WHEN 'es' THEN 'Spain'
    WHEN 'united kingdom' THEN 'United Kingdom'
    WHEN 'uk' THEN 'United Kingdom'
    WHEN 'gb' THEN 'United Kingdom'
    WHEN 'great britain' THEN 'United Kingdom'
    WHEN 'england' THEN 'United Kingdom'
    WHEN 'germany' THEN 'Germany'
    WHEN 'deutschland' THEN 'Germany'
    WHEN 'de' THEN 'Germany'
    WHEN 'france' THEN 'France'
    WHEN 'francia' THEN 'France'
    WHEN 'fr' THEN 'France'
    WHEN 'italy' THEN 'Italy'
    WHEN 'italia' THEN 'Italy'
    WHEN 'it' THEN 'Italy'
    WHEN 'portugal' THEN 'Portugal'
    WHEN 'pt' THEN 'Portugal'
    WHEN 'netherlands' THEN 'Netherlands'
    WHEN 'holanda' THEN 'Netherlands'
    WHEN 'nl' THEN 'Netherlands'
    WHEN 'belgium' THEN 'Belgium'
    WHEN 'bélgica' THEN 'Belgium'
    WHEN 'be' THEN 'Belgium'
    WHEN 'switzerland' THEN 'Switzerland'
    WHEN 'suiza' THEN 'Switzerland'
    WHEN 'ch' THEN 'Switzerland'
    WHEN 'austria' THEN 'Austria'
    WHEN 'at' THEN 'Austria'
    WHEN 'sweden' THEN 'Sweden'
    WHEN 'suecia' THEN 'Sweden'
    WHEN 'se' THEN 'Sweden'
    WHEN 'norway' THEN 'Norway'
    WHEN 'noruega' THEN 'Norway'
    WHEN 'no' THEN 'Norway'
    WHEN 'denmark' THEN 'Denmark'
    WHEN 'dinamarca' THEN 'Denmark'
    WHEN 'dk' THEN 'Denmark'
    WHEN 'finland' THEN 'Finland'
    WHEN 'finlandia' THEN 'Finland'
    WHEN 'fi' THEN 'Finland'
    WHEN 'ireland' THEN 'Ireland'
    WHEN 'irlanda' THEN 'Ireland'
    WHEN 'ie' THEN 'Ireland'
    WHEN 'poland' THEN 'Poland'
    WHEN 'polonia' THEN 'Poland'
    WHEN 'pl' THEN 'Poland'
    WHEN 'czech republic' THEN 'Czech Republic'
    WHEN 'czechia' THEN 'Czech Republic'
    WHEN 'república checa' THEN 'Czech Republic'
    WHEN 'cz' THEN 'Czech Republic'
    WHEN 'romania' THEN 'Romania'
    WHEN 'rumania' THEN 'Romania'
    WHEN 'ro' THEN 'Romania'
    WHEN 'hungary' THEN 'Hungary'
    WHEN 'hungría' THEN 'Hungary'
    WHEN 'hu' THEN 'Hungary'
    WHEN 'greece' THEN 'Greece'
    WHEN 'grecia' THEN 'Greece'
    WHEN 'gr' THEN 'Greece'
    WHEN 'russia' THEN 'Russia'
    WHEN 'rusia' THEN 'Russia'
    WHEN 'ru' THEN 'Russia'
    WHEN 'ukraine' THEN 'Ukraine'
    WHEN 'ucrania' THEN 'Ukraine'
    WHEN 'ua' THEN 'Ukraine'

    -- North America
    WHEN 'united states' THEN 'United States'
    WHEN 'usa' THEN 'United States'
    WHEN 'us' THEN 'United States'
    WHEN 'estados unidos' THEN 'United States'
    WHEN 'eeuu' THEN 'United States'
    WHEN 'canada' THEN 'Canada'
    WHEN 'canadá' THEN 'Canada'
    WHEN 'ca' THEN 'Canada'

    -- Oceania
    WHEN 'australia' THEN 'Australia'
    WHEN 'au' THEN 'Australia'
    WHEN 'new zealand' THEN 'New Zealand'
    WHEN 'nueva zelanda' THEN 'New Zealand'
    WHEN 'nz' THEN 'New Zealand'

    -- Asia
    WHEN 'japan' THEN 'Japan'
    WHEN 'japón' THEN 'Japan'
    WHEN 'jp' THEN 'Japan'
    WHEN 'china' THEN 'China'
    WHEN 'cn' THEN 'China'
    WHEN 'india' THEN 'India'
    WHEN 'in' THEN 'India'
    WHEN 'south korea' THEN 'South Korea'
    WHEN 'korea' THEN 'South Korea'
    WHEN 'corea del sur' THEN 'South Korea'
    WHEN 'corea' THEN 'South Korea'
    WHEN 'kr' THEN 'South Korea'
    WHEN 'singapore' THEN 'Singapore'
    WHEN 'singapur' THEN 'Singapore'
    WHEN 'sg' THEN 'Singapore'
    WHEN 'philippines' THEN 'Philippines'
    WHEN 'filipinas' THEN 'Philippines'
    WHEN 'ph' THEN 'Philippines'
    WHEN 'thailand' THEN 'Thailand'
    WHEN 'tailandia' THEN 'Thailand'
    WHEN 'th' THEN 'Thailand'
    WHEN 'vietnam' THEN 'Vietnam'
    WHEN 'vn' THEN 'Vietnam'
    WHEN 'indonesia' THEN 'Indonesia'
    WHEN 'id' THEN 'Indonesia'
    WHEN 'malaysia' THEN 'Malaysia'
    WHEN 'malasia' THEN 'Malaysia'
    WHEN 'my' THEN 'Malaysia'
    WHEN 'taiwan' THEN 'Taiwan'
    WHEN 'tw' THEN 'Taiwan'
    WHEN 'hong kong' THEN 'Hong Kong'
    WHEN 'hk' THEN 'Hong Kong'
    WHEN 'pakistan' THEN 'Pakistan'
    WHEN 'pk' THEN 'Pakistan'
    WHEN 'bangladesh' THEN 'Bangladesh'
    WHEN 'bd' THEN 'Bangladesh'

    -- Middle East
    WHEN 'israel' THEN 'Israel'
    WHEN 'il' THEN 'Israel'
    WHEN 'turkey' THEN 'Turkey'
    WHEN 'turquía' THEN 'Turkey'
    WHEN 'tr' THEN 'Turkey'
    WHEN 'uae' THEN 'United Arab Emirates'
    WHEN 'united arab emirates' THEN 'United Arab Emirates'
    WHEN 'emiratos árabes unidos' THEN 'United Arab Emirates'
    WHEN 'ae' THEN 'United Arab Emirates'
    WHEN 'saudi arabia' THEN 'Saudi Arabia'
    WHEN 'arabia saudita' THEN 'Saudi Arabia'
    WHEN 'sa' THEN 'Saudi Arabia'
    WHEN 'qatar' THEN 'Qatar'
    WHEN 'qa' THEN 'Qatar'
    WHEN 'kuwait' THEN 'Kuwait'
    WHEN 'kw' THEN 'Kuwait'
    WHEN 'jordan' THEN 'Jordan'
    WHEN 'jordania' THEN 'Jordan'
    WHEN 'jo' THEN 'Jordan'
    WHEN 'lebanon' THEN 'Lebanon'
    WHEN 'líbano' THEN 'Lebanon'
    WHEN 'lb' THEN 'Lebanon'

    -- Africa
    WHEN 'south africa' THEN 'South Africa'
    WHEN 'sudáfrica' THEN 'South Africa'
    WHEN 'za' THEN 'South Africa'
    WHEN 'nigeria' THEN 'Nigeria'
    WHEN 'ng' THEN 'Nigeria'
    WHEN 'kenya' THEN 'Kenya'
    WHEN 'ke' THEN 'Kenya'
    WHEN 'egypt' THEN 'Egypt'
    WHEN 'egipto' THEN 'Egypt'
    WHEN 'eg' THEN 'Egypt'
    WHEN 'morocco' THEN 'Morocco'
    WHEN 'marruecos' THEN 'Morocco'
    WHEN 'ma' THEN 'Morocco'
    WHEN 'ghana' THEN 'Ghana'
    WHEN 'gh' THEN 'Ghana'
    WHEN 'ethiopia' THEN 'Ethiopia'
    WHEN 'etiopía' THEN 'Ethiopia'
    WHEN 'et' THEN 'Ethiopia'
    WHEN 'tanzania' THEN 'Tanzania'
    WHEN 'tz' THEN 'Tanzania'
    WHEN 'uganda' THEN 'Uganda'
    WHEN 'ug' THEN 'Uganda'

    -- Others
    WHEN 'andorra' THEN 'Andorra'
    WHEN 'ad' THEN 'Andorra'
    WHEN 'albania' THEN 'Albania'
    WHEN 'al' THEN 'Albania'
    WHEN 'algeria' THEN 'Algeria'
    WHEN 'argelia' THEN 'Algeria'
    WHEN 'dz' THEN 'Algeria'
    WHEN 'angola' THEN 'Angola'
    WHEN 'ao' THEN 'Angola'
    WHEN 'afghanistan' THEN 'Afghanistan'
    WHEN 'afganistán' THEN 'Afghanistan'
    WHEN 'af' THEN 'Afghanistan'
    ELSE NULL
  END;

  IF result IS NULL AND clean_country LIKE '%,%' THEN
    parts := string_to_array(clean_country, ',');
    last_part := btrim(parts[array_length(parts, 1)]);

    IF last_part IS NOT NULL AND last_part <> clean_country THEN
      result := public.normalize_country(last_part);
    END IF;
  END IF;

  RETURN result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_document_tag_industry()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Solo procesar si es tag de industria
  IF NEW.tag_type = 'industry' AND NEW.tag_value IS NOT NULL AND NEW.tag_value != '' THEN
    -- Buscar mapeo existente (case insensitive)
    SELECT master_industry_id INTO NEW.master_industry_id
    FROM industry_mappings
    WHERE LOWER(original_value) = LOWER(NEW.tag_value)
      AND source_type = 'document';
  END IF;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_linkedin_url(url text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
BEGIN
  IF url IS NULL OR url = '' THEN RETURN NULL; END IF;
  -- Basic cleanup: lower case, remove query params
  url := lower(regexp_replace(url, '\?.*$', '', 'g'));
  -- Normalize domain: replace 'sv.linkedin.com', 'mx.linkedin.com' etc with 'www.linkedin.com'
  url := regexp_replace(url, 'https?://([a-z]{2,3}\.)?linkedin\.com/', 'https://www.linkedin.com/', 'g');
  -- Ensure protocol is https
  IF url NOT LIKE 'https://%' THEN
     url := replace(url, 'http://', 'https://');
  END IF;
  -- Remove trailing slash
  url := regexp_replace(url, '/$', '', 'g');
  RETURN url;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.on_industry_mapping_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- INSERT o UPDATE: propagar nuevo mapeo
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    -- Actualizar companies si es mapeo de company
    IF NEW.source_type = 'company' THEN
      UPDATE companies
      SET master_industry_id = NEW.master_industry_id
      WHERE LOWER(industry) = LOWER(NEW.original_value)
        AND (master_industry_id IS DISTINCT FROM NEW.master_industry_id);
    END IF;
    
    -- Actualizar document_tags si es mapeo de document
    IF NEW.source_type = 'document' THEN
      UPDATE document_tags
      SET master_industry_id = NEW.master_industry_id
      WHERE tag_type = 'industry'
        AND LOWER(tag_value) = LOWER(NEW.original_value)
        AND (master_industry_id IS DISTINCT FROM NEW.master_industry_id);
    END IF;
    
    RETURN NEW;
  END IF;
  
  -- DELETE: limpiar master_industry_id de registros afectados
  IF TG_OP = 'DELETE' THEN
    IF OLD.source_type = 'company' THEN
      UPDATE companies
      SET master_industry_id = NULL
      WHERE LOWER(industry) = LOWER(OLD.original_value);
    END IF;
    
    IF OLD.source_type = 'document' THEN
      UPDATE document_tags
      SET master_industry_id = NULL
      WHERE tag_type = 'industry'
        AND LOWER(tag_value) = LOWER(OLD.original_value);
    END IF;
    
    RETURN OLD;
  END IF;
  
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.parse_csv_array(input_text text)
 RETURNS text[]
 LANGUAGE plpgsql
AS $function$
DECLARE
    cleaned_text TEXT;
BEGIN
    -- Remove outer brackets and quotes if present
    cleaned_text := TRIM(BOTH '[]"' FROM input_text);
    -- Replace double quotes with nothing inside the string if needed, or handle CSV escaping
    -- Simple split by comma and quote handling
    RETURN string_to_array(cleaned_text, '","');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.pick_best_email(p_email1 text, p_email2 text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_email1 is null and p_email2 is null then null
    when p_email1 is null then p_email2
    when p_email2 is null then p_email1
    when public.is_personal_email(p_email1) and not public.is_personal_email(p_email2)
      then p_email2
    else p_email1
  end
$function$
;

CREATE OR REPLACE FUNCTION public.pick_merge_master(p_ids uuid[])
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT c.id
  FROM public.companies c
  LEFT JOIN LATERAL (
    SELECT
      (SELECT count(*) FROM public.job_postings jp WHERE jp.company_id = c.id)
      + (SELECT count(*) FROM public.contacts ct WHERE ct.current_company_id = c.id)
      + (SELECT count(*) FROM public.company_news cn WHERE cn.company_id = c.id)
      AS total
  ) d ON true
  WHERE c.id = ANY(p_ids)
  ORDER BY
    d.total DESC NULLS LAST,
    (c.linkedin_url IS NOT NULL) DESC,
    (c.website IS NOT NULL) DESC,
    c.created_at ASC
  LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.process_add_keyword_contacts(p_signal_id uuid, p_signal_type text, p_keyword text, p_batch_size integer, p_cursor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pattern text;
  v_ids uuid[];
  v_new_cursor uuid;
  v_window_count integer;
  v_signals_created integer := 0;
  v_inserted integer;
BEGIN
  v_pattern := '\y' || public.escape_regex(p_keyword) || '\y';

  -- Ventana keyset. Columnas SIN COALESCE para que el planner use los índices
  -- trigram (NULL ~* patrón => NULL => no matchea, idéntico a '' ~* patrón).
  SELECT array_agg(id ORDER BY id)
  INTO v_ids
  FROM (
    SELECT c.id
    FROM public.contacts c
    WHERE (p_cursor IS NULL OR c.id > p_cursor)
      AND (
        c.current_position_title       ~* v_pattern OR
        c.headline                      ~* v_pattern OR
        c.about                         ~* v_pattern OR
        c.current_position_description   ~* v_pattern OR
        public.contacts_prevpos_text(c.previous_positions) ~* v_pattern
      )
    ORDER BY c.id
    LIMIT p_batch_size
  ) s;

  v_window_count := COALESCE(array_length(v_ids, 1), 0);

  IF v_window_count = 0 THEN
    RETURN jsonb_build_object(
      'success', true, 'processed', 0, 'signals_created', 0,
      'cursor', p_cursor, 'has_more', false
    );
  END IF;

  v_new_cursor := v_ids[v_window_count];

  -- (a) POSICIÓN ACTUAL
  WITH ins AS (
    INSERT INTO public.signals (
      contact_id, company_id, signal_type, signal_id, keyword_matched,
      source_field, is_current_employee, snippet
    )
    SELECT
      c.id,
      c.current_company_id,
      p_signal_type,
      p_signal_id,
      p_keyword,
      CASE
        WHEN COALESCE(c.current_position_title, '')     ~* v_pattern THEN 'current_position'
        WHEN COALESCE(c.headline, '')                    ~* v_pattern THEN 'headline'
        WHEN COALESCE(c.about, '')                        ~* v_pattern THEN 'about'
        ELSE 'current_position_description'
      END,
      TRUE,
      public.extract_snippet(
        COALESCE(c.current_position_title, '') || ' ' ||
        COALESCE(c.headline, '') || ' ' ||
        COALESCE(c.about, '') || ' ' ||
        COALESCE(c.current_position_description, ''),
        p_keyword, 100
      )
    FROM public.contacts c
    WHERE c.id = ANY(v_ids)
      AND c.current_company_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.companies co WHERE co.id = c.current_company_id)
      AND (
        c.current_position_title     ~* v_pattern OR
        c.headline                    ~* v_pattern OR
        c.about                        ~* v_pattern OR
        c.current_position_description ~* v_pattern
      )
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;
  v_signals_created := v_signals_created + v_inserted;

  -- (b) POSICIONES PREVIAS
  WITH ins AS (
    INSERT INTO public.signals (
      contact_id, company_id, signal_type, signal_id, keyword_matched,
      source_field, is_current_employee, snippet
    )
    SELECT
      c.id,
      (pos->>'company_id')::uuid,
      p_signal_type,
      p_signal_id,
      p_keyword,
      'previous_position',
      FALSE,
      public.extract_snippet(
        COALESCE(pos->>'title', '') || ' ' || COALESCE(pos->>'description', ''),
        p_keyword, 100
      )
    FROM public.contacts c
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(c.previous_positions) = 'array'
           THEN c.previous_positions ELSE '[]'::jsonb END
    ) AS pos
    WHERE c.id = ANY(v_ids)
      AND (pos->>'company_id') IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.companies co WHERE co.id = (pos->>'company_id')::uuid)
      AND (COALESCE(pos->>'title', '') || ' ' || COALESCE(pos->>'description', '')) ~* v_pattern
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;
  v_signals_created := v_signals_created + v_inserted;

  RETURN jsonb_build_object(
    'success', true,
    'processed', v_window_count,
    'signals_created', v_signals_created,
    'cursor', v_new_cursor,
    'has_more', (v_window_count = p_batch_size)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_add_keyword_job_postings(p_signal_id uuid, p_signal_type text, p_keyword text, p_batch_size integer, p_cursor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pattern text;
  v_six_months_ago timestamptz := NOW() - INTERVAL '6 months';
  v_ids uuid[];
  v_new_cursor uuid;
  v_window_count integer;
  v_signals_created integer := 0;
BEGIN
  v_pattern := '\y' || public.escape_regex(p_keyword) || '\y';

  SELECT array_agg(id ORDER BY id)
  INTO v_ids
  FROM (
    SELECT jp.id
    FROM public.job_postings jp
    WHERE (p_cursor IS NULL OR jp.id > p_cursor)
      AND jp.posted_at >= v_six_months_ago
      AND (jp.title ~* v_pattern OR jp.description ~* v_pattern)
    ORDER BY jp.id
    LIMIT p_batch_size
  ) s;

  v_window_count := COALESCE(array_length(v_ids, 1), 0);

  IF v_window_count = 0 THEN
    RETURN jsonb_build_object(
      'success', true, 'processed', 0, 'signals_created', 0,
      'cursor', p_cursor, 'has_more', false
    );
  END IF;

  v_new_cursor := v_ids[v_window_count];

  WITH ins AS (
    INSERT INTO public.signals (
      job_posting_id, company_id, signal_type, signal_id, keyword_matched,
      source_field, job_posted_at, snippet
    )
    SELECT
      jp.id,
      jp.company_id,
      p_signal_type,
      p_signal_id,
      p_keyword,
      CASE WHEN COALESCE(jp.title, '') ~* v_pattern THEN 'job_title' ELSE 'job_description' END,
      jp.posted_at,
      public.extract_snippet(COALESCE(jp.title, '') || ' ' || COALESCE(jp.description, ''), p_keyword, 100)
    FROM public.job_postings jp
    JOIN public.companies c ON c.id = jp.company_id
    WHERE jp.id = ANY(v_ids)
      AND (jp.title ~* v_pattern OR jp.description ~* v_pattern)
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_signals_created FROM ins;

  RETURN jsonb_build_object(
    'success', true,
    'processed', v_window_count,
    'signals_created', v_signals_created,
    'cursor', v_new_cursor,
    'has_more', (v_window_count = p_batch_size)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_contact_batch_internal(p_batch_id uuid, p_limit integer DEFAULT 5)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_row RECORD;
  v_processed_count INTEGER := 0;
  v_retry_count INTEGER := 0;
  v_max_retries INTEGER := 3;
  v_retry_delay INTEGER;
  v_current_company_id UUID;
  v_contact_id UUID;
  v_prev_company_id UUID;
  v_prev_positions JSONB := '[]'::JSONB;
  v_position_obj JSONB;
BEGIN
  FOR v_row IN 
    SELECT * FROM public.import_rows 
    WHERE batch_id = p_batch_id AND status = 'pending'
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    v_retry_count := 0;
    
    <<retry_loop>>
    LOOP
      BEGIN
        -- Process current company
        v_current_company_id := public.upsert_company(
          (v_row.row_data->>'company_name')::TEXT,
          (v_row.row_data->>'company_linkedin_url')::TEXT,
          (v_row.row_data->>'company_website')::TEXT,
          (v_row.row_data->>'company_industry')::TEXT,
          (v_row.row_data->>'company_country')::TEXT,
          (v_row.row_data->>'company_logo_url')::TEXT,
          (v_row.row_data->>'company_description')::TEXT
        );
        
        -- Process previous positions (1-6)
        v_prev_positions := '[]'::JSONB;
        FOR i IN 1..6 LOOP
          IF v_row.row_data ? ('previous_company_' || i) AND 
             (v_row.row_data->>('previous_company_' || i)) IS NOT NULL AND
             (v_row.row_data->>('previous_company_' || i)) != '' THEN
            
            v_prev_company_id := public.upsert_company(
              (v_row.row_data->>('previous_company_' || i))::TEXT,
              NULL, NULL, NULL, NULL, NULL, NULL
            );
            
            v_position_obj := jsonb_build_object(
              'company_id', v_prev_company_id,
              'company_name', v_row.row_data->>('previous_company_' || i),
              'title', v_row.row_data->>('previous_position_' || i),
              'description', v_row.row_data->>('previous_position_' || i || '_description')
            );
            
            v_prev_positions := v_prev_positions || v_position_obj;
          END IF;
        END LOOP;

        -- Upsert contact
        INSERT INTO public.contacts (
          linkedin_url, first_name, last_name, full_name, headline, about,
          current_company_id, current_position_title, current_position_description,
          previous_positions, country, profile_picture_url,
          email1, email1_type, email1_status,
          email2, email2_type, email2_status,
          email3, email3_type, email3_status,
          email4, email4_type, email4_status,
          phone1, phone1_type, phone1_status,
          phone2, phone2_type, phone2_status
        ) VALUES (
          COALESCE((v_row.row_data->>'linkedin_url')::TEXT, 'placeholder:' || gen_random_uuid()::TEXT),
          (v_row.row_data->>'first_name')::TEXT, (v_row.row_data->>'last_name')::TEXT,
          (v_row.row_data->>'full_name')::TEXT, (v_row.row_data->>'headline')::TEXT,
          (v_row.row_data->>'about')::TEXT, v_current_company_id,
          (v_row.row_data->>'current_position')::TEXT, (v_row.row_data->>'current_position_description')::TEXT,
          v_prev_positions, (v_row.row_data->>'country')::TEXT, (v_row.row_data->>'profile_picture_url')::TEXT,
          (v_row.row_data->>'email1')::TEXT, (v_row.row_data->>'email1_type')::TEXT, (v_row.row_data->>'email1_status')::TEXT,
          (v_row.row_data->>'email2')::TEXT, (v_row.row_data->>'email2_type')::TEXT, (v_row.row_data->>'email2_status')::TEXT,
          (v_row.row_data->>'email3')::TEXT, (v_row.row_data->>'email3_type')::TEXT, (v_row.row_data->>'email3_status')::TEXT,
          (v_row.row_data->>'email4')::TEXT, (v_row.row_data->>'email4_type')::TEXT, (v_row.row_data->>'email4_status')::TEXT,
          (v_row.row_data->>'phone1')::TEXT, (v_row.row_data->>'phone1_type')::TEXT, (v_row.row_data->>'phone1_status')::TEXT,
          (v_row.row_data->>'phone2')::TEXT, (v_row.row_data->>'phone2_type')::TEXT, (v_row.row_data->>'phone2_status')::TEXT
        )
        ON CONFLICT (linkedin_url) DO UPDATE SET
          first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, full_name = EXCLUDED.full_name,
          headline = EXCLUDED.headline, about = EXCLUDED.about, current_company_id = EXCLUDED.current_company_id,
          current_position_title = EXCLUDED.current_position_title, current_position_description = EXCLUDED.current_position_description,
          previous_positions = EXCLUDED.previous_positions, country = EXCLUDED.country, profile_picture_url = EXCLUDED.profile_picture_url,
          updated_at = timezone('utc'::text, now())
        RETURNING id INTO v_contact_id;
        
        PERFORM public.process_contact_signals(v_contact_id);
        
        UPDATE public.import_rows SET status = 'processed', processed_at = timezone('utc'::text, now()) WHERE id = v_row.id;
        v_processed_count := v_processed_count + 1;
        
        EXIT retry_loop;
        
      EXCEPTION 
        WHEN serialization_failure OR deadlock_detected THEN
          v_retry_count := v_retry_count + 1;
          
          IF v_retry_count >= v_max_retries THEN
            INSERT INTO public.debug_events (batch_id, event_type, message, details)
            VALUES (p_batch_id, 'row_error', 'Error processing contact row', 
              jsonb_build_object('row_id', v_row.id, 'error', SQLERRM, 'retries_exhausted', v_retry_count));
            
            UPDATE public.import_rows 
            SET status = 'failed', error_message = 'Deadlock after ' || v_retry_count || ' retries: ' || SQLERRM 
            WHERE id = v_row.id;
            
            EXIT retry_loop;
          ELSE
            v_retry_delay := 10 * (5 ^ (v_retry_count - 1));
            
            INSERT INTO public.debug_events (batch_id, event_type, message, details)
            VALUES (p_batch_id, 'row_retry', 'Retrying contact row after deadlock', 
              jsonb_build_object('row_id', v_row.id, 'retry_count', v_retry_count, 'delay_ms', v_retry_delay));
            
            PERFORM pg_sleep(v_retry_delay::FLOAT / 1000.0);
            
            CONTINUE retry_loop;
          END IF;
          
        WHEN OTHERS THEN
          INSERT INTO public.debug_events (batch_id, event_type, message, details)
          VALUES (p_batch_id, 'row_error', 'Error processing contact row', 
            jsonb_build_object('row_id', v_row.id, 'error', SQLERRM));
          
          UPDATE public.import_rows 
          SET status = 'failed', error_message = SQLERRM 
          WHERE id = v_row.id;
          
          EXIT retry_loop;
      END;
    END LOOP;
  END LOOP;
  
  RETURN v_processed_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_contact_signals(contact_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_contact RECORD;
  v_position JSONB;
  v_company_id UUID;
  v_dict RECORD;
  v_matched_kw TEXT;
  v_fields TEXT[];
  v_field_names TEXT[];
  v_field_text TEXT;
  i INT;
BEGIN
  SELECT * INTO v_contact FROM public.contacts WHERE id = contact_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- ── CURRENT POSITION SIGNALS ──
  IF v_contact.current_company_id IS NOT NULL THEN
    v_fields := ARRAY[
      COALESCE(v_contact.current_position_title, ''),
      COALESCE(v_contact.headline, ''),
      COALESCE(v_contact.about, '')
    ];
    v_field_names := ARRAY['current_position', 'headline', 'about'];

    FOR v_dict IN SELECT dict_type, dict_id, pattern, keywords FROM public.dictionary_patterns_cache
    LOOP
      FOR i IN 1..3 LOOP
        IF v_fields[i] = '' THEN CONTINUE; END IF;

        -- Fast check: does the combined pattern match at all? (~* is fast for compiled regex)
        IF v_fields[i] ~* v_dict.pattern THEN
          -- OPTIMIZATION: extract matched keyword directly via regexp_matches
          -- instead of looping through unnest(keywords) with individual regex per keyword
          v_matched_kw := (regexp_matches(v_fields[i], v_dict.pattern, 'i'))[1];

          IF v_matched_kw IS NOT NULL THEN
            INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
            VALUES (
              contact_id,
              v_contact.current_company_id,
              v_dict.dict_type,
              v_dict.dict_id,
              v_matched_kw,
              v_field_names[i],
              TRUE,
              public.extract_snippet(v_fields[i], v_matched_kw, 100)
            )
            ON CONFLICT DO NOTHING;
            EXIT; -- Found signal for this dict entry, move to next dict
          END IF;
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  -- ── PAST POSITION SIGNALS ──
  IF v_contact.previous_positions IS NOT NULL THEN
    FOR v_position IN SELECT * FROM jsonb_array_elements(v_contact.previous_positions)
    LOOP
      v_company_id := (v_position->>'company_id')::UUID;
      
      IF v_company_id IS NOT NULL AND v_company_id != v_contact.current_company_id THEN
        v_field_text := COALESCE(v_position->>'title', '');

        IF v_field_text != '' THEN
          FOR v_dict IN SELECT dict_type, dict_id, pattern, keywords FROM public.dictionary_patterns_cache
          LOOP
            IF v_field_text ~* v_dict.pattern THEN
              v_matched_kw := (regexp_matches(v_field_text, v_dict.pattern, 'i'))[1];

              IF v_matched_kw IS NOT NULL THEN
                INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
                VALUES (contact_id, v_company_id, v_dict.dict_type, v_dict.dict_id, v_matched_kw, 'past_position', FALSE, public.extract_snippet(v_field_text, v_matched_kw, 100))
                ON CONFLICT DO NOTHING;
              END IF;
            END IF;
          END LOOP;
        END IF;
      END IF;
    END LOOP;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_dictionary_job(p_job_id uuid, p_batch_size integer DEFAULT 5000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '40s'
AS $function$
DECLARE
  v_job RECORD;
  v_result JSONB;
  v_pattern text;
  v_ids uuid[];
  v_new_cursor uuid;
  v_window_count integer;
  v_matched integer;
  v_signals_created integer := 0;
  v_inserted integer;
  v_has_more boolean := false;
  v_six_months_ago timestamptz := NOW() - INTERVAL '6 months';
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_job_id::text, 0)) THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'locked');
  END IF;

  SELECT * INTO v_job FROM public.dictionary_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Job not found');
  END IF;

  IF v_job.status = 'pending' THEN
    UPDATE public.dictionary_jobs
    SET status = 'processing', started_at = NOW()
    WHERE id = p_job_id;
    SELECT * INTO v_job FROM public.dictionary_jobs WHERE id = p_job_id;
  END IF;

  IF v_job.job_type = 'remove_keyword' THEN
    v_result := public.process_remove_keyword(v_job.signal_id, v_job.keyword);
    UPDATE public.dictionary_jobs
    SET status = 'completed', completed_at = NOW(), progress = 100,
        processed_records = (v_result->>'deleted_count')::INTEGER,
        total_records = (v_result->>'deleted_count')::INTEGER,
        phase = 'done'
    WHERE id = p_job_id;
    RETURN v_result;
  END IF;

  IF v_job.job_type <> 'add_keyword' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown job type');
  END IF;

  v_pattern := '\y' || public.escape_regex(v_job.keyword) || '\y';

  IF v_job.phase IS NULL OR v_job.phase = 'contacts' OR v_job.phase = 'match_contacts' THEN
    DELETE FROM public.dictionary_job_matches
    WHERE job_id = p_job_id AND entity_type = 'contact';

    INSERT INTO public.dictionary_job_matches (job_id, entity_type, entity_id)
    SELECT p_job_id, 'contact', c.id
    FROM public.contacts c
    WHERE (
      c.current_position_title       ~* v_pattern OR
      c.headline                      ~* v_pattern OR
      c.about                         ~* v_pattern OR
      c.current_position_description   ~* v_pattern OR
      public.contacts_prevpos_text(c.previous_positions) ~* v_pattern
    )
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_matched = ROW_COUNT;

    UPDATE public.dictionary_jobs
    SET phase = 'insert_contacts', contacts_cursor = NULL,
        total_records = v_matched, progress = LEAST(30, progress)
    WHERE id = p_job_id;

    RETURN jsonb_build_object('success', true, 'phase', 'insert_contacts',
      'processed', 0, 'signals_created', 0, 'matched', v_matched, 'has_more', true);
  END IF;

  IF v_job.phase = 'insert_contacts' THEN
    SELECT array_agg(entity_id ORDER BY entity_id) INTO v_ids
    FROM (
      SELECT m.entity_id FROM public.dictionary_job_matches m
      WHERE m.job_id = p_job_id AND m.entity_type = 'contact'
        AND (v_job.contacts_cursor IS NULL OR m.entity_id > v_job.contacts_cursor)
      ORDER BY m.entity_id LIMIT p_batch_size
    ) s;

    v_window_count := COALESCE(array_length(v_ids, 1), 0);

    IF v_window_count = 0 THEN
      UPDATE public.dictionary_jobs SET phase = 'match_jobs' WHERE id = p_job_id;
      RETURN jsonb_build_object('success', true, 'phase', 'match_jobs',
        'processed', 0, 'signals_created', 0, 'has_more', true);
    END IF;

    v_new_cursor := v_ids[v_window_count];

    WITH ins AS (
      INSERT INTO public.signals (
        contact_id, company_id, signal_type, signal_id, keyword_matched,
        source_field, is_current_employee, snippet
      )
      SELECT c.id, c.current_company_id, v_job.signal_type, v_job.signal_id, v_job.keyword,
        CASE
          WHEN COALESCE(c.current_position_title, '')     ~* v_pattern THEN 'current_position'
          WHEN COALESCE(c.headline, '')                    ~* v_pattern THEN 'headline'
          WHEN COALESCE(c.about, '')                        ~* v_pattern THEN 'about'
          ELSE 'current_position_description'
        END,
        TRUE,
        public.extract_snippet(
          COALESCE(c.current_position_title, '') || ' ' || COALESCE(c.headline, '') || ' ' ||
          COALESCE(c.about, '') || ' ' || COALESCE(c.current_position_description, ''),
          v_job.keyword, 100)
      FROM public.contacts c
      WHERE c.id = ANY(v_ids)
        AND c.current_company_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.companies co WHERE co.id = c.current_company_id)
        AND (
          c.current_position_title     ~* v_pattern OR
          c.headline                    ~* v_pattern OR
          c.about                        ~* v_pattern OR
          c.current_position_description ~* v_pattern
        )
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_inserted FROM ins;
    v_signals_created := v_signals_created + v_inserted;

    WITH ins AS (
      INSERT INTO public.signals (
        contact_id, company_id, signal_type, signal_id, keyword_matched,
        source_field, is_current_employee, snippet
      )
      SELECT c.id, (pos->>'company_id')::uuid, v_job.signal_type, v_job.signal_id, v_job.keyword,
        'previous_position', FALSE,
        public.extract_snippet(
          COALESCE(pos->>'title', '') || ' ' || COALESCE(pos->>'description', ''),
          v_job.keyword, 100)
      FROM public.contacts c
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(c.previous_positions) = 'array'
             THEN c.previous_positions ELSE '[]'::jsonb END
      ) AS pos
      WHERE c.id = ANY(v_ids)
        AND (pos->>'company_id') IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.companies co WHERE co.id = (pos->>'company_id')::uuid)
        AND (COALESCE(pos->>'title', '') || ' ' || COALESCE(pos->>'description', '')) ~* v_pattern
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_inserted FROM ins;
    v_signals_created := v_signals_created + v_inserted;

    v_has_more := (v_window_count = p_batch_size);

    UPDATE public.dictionary_jobs
    SET contacts_processed = COALESCE(contacts_processed, 0) + v_window_count,
        contacts_cursor = v_new_cursor,
        processed_records = COALESCE(contacts_processed, 0) + v_window_count,
        progress = CASE WHEN v_has_more THEN LEAST(59, GREATEST(progress, 40)) ELSE 60 END,
        phase = CASE WHEN v_has_more THEN 'insert_contacts' ELSE 'match_jobs' END
    WHERE id = p_job_id;

    RETURN jsonb_build_object('success', true,
      'phase', CASE WHEN v_has_more THEN 'insert_contacts' ELSE 'match_jobs' END,
      'processed', v_window_count, 'signals_created', v_signals_created, 'has_more', true);
  END IF;

  IF v_job.phase = 'match_jobs' OR v_job.phase = 'job_postings' THEN
    DELETE FROM public.dictionary_job_matches
    WHERE job_id = p_job_id AND entity_type = 'job_posting';

    INSERT INTO public.dictionary_job_matches (job_id, entity_type, entity_id)
    SELECT p_job_id, 'job_posting', jp.id
    FROM public.job_postings jp
    WHERE jp.posted_at >= v_six_months_ago
      AND (jp.title ~* v_pattern OR jp.description ~* v_pattern)
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_matched = ROW_COUNT;

    UPDATE public.dictionary_jobs
    SET phase = 'insert_jobs', job_postings_cursor = NULL
    WHERE id = p_job_id;

    RETURN jsonb_build_object('success', true, 'phase', 'insert_jobs',
      'processed', 0, 'signals_created', 0, 'matched', v_matched, 'has_more', true);
  END IF;

  IF v_job.phase = 'insert_jobs' THEN
    SELECT array_agg(entity_id ORDER BY entity_id) INTO v_ids
    FROM (
      SELECT m.entity_id FROM public.dictionary_job_matches m
      WHERE m.job_id = p_job_id AND m.entity_type = 'job_posting'
        AND (v_job.job_postings_cursor IS NULL OR m.entity_id > v_job.job_postings_cursor)
      ORDER BY m.entity_id LIMIT p_batch_size
    ) s;

    v_window_count := COALESCE(array_length(v_ids, 1), 0);

    IF v_window_count = 0 THEN
      DELETE FROM public.dictionary_job_matches WHERE job_id = p_job_id;
      UPDATE public.dictionary_jobs
      SET status = 'completed', completed_at = NOW(), progress = 100, phase = 'done',
          processed_records = COALESCE(contacts_processed, 0) + COALESCE(job_postings_processed, 0),
          total_records = COALESCE(contacts_processed, 0) + COALESCE(job_postings_processed, 0)
      WHERE id = p_job_id;
      RETURN jsonb_build_object('success', true, 'phase', 'done',
        'processed', 0, 'signals_created', 0, 'has_more', false);
    END IF;

    v_new_cursor := v_ids[v_window_count];

    WITH ins AS (
      INSERT INTO public.signals (
        job_posting_id, company_id, signal_type, signal_id, keyword_matched,
        source_field, job_posted_at, snippet
      )
      SELECT jp.id, jp.company_id, v_job.signal_type, v_job.signal_id, v_job.keyword,
        CASE WHEN COALESCE(jp.title, '') ~* v_pattern THEN 'job_title' ELSE 'job_description' END,
        jp.posted_at,
        public.extract_snippet(COALESCE(jp.title, '') || ' ' || COALESCE(jp.description, ''), v_job.keyword, 100)
      FROM public.job_postings jp
      JOIN public.companies c ON c.id = jp.company_id
      WHERE jp.id = ANY(v_ids)
        AND (jp.title ~* v_pattern OR jp.description ~* v_pattern)
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_signals_created FROM ins;

    v_has_more := (v_window_count = p_batch_size);

    UPDATE public.dictionary_jobs
    SET job_postings_processed = COALESCE(job_postings_processed, 0) + v_window_count,
        job_postings_cursor = v_new_cursor,
        processed_records = COALESCE(contacts_processed, 0) + COALESCE(job_postings_processed, 0) + v_window_count,
        progress = LEAST(99, GREATEST(progress, 70))
    WHERE id = p_job_id;

    IF NOT v_has_more THEN
      DELETE FROM public.dictionary_job_matches WHERE job_id = p_job_id;
      UPDATE public.dictionary_jobs
      SET status = 'completed', completed_at = NOW(), progress = 100, phase = 'done',
          processed_records = COALESCE(contacts_processed, 0) + COALESCE(job_postings_processed, 0),
          total_records = COALESCE(contacts_processed, 0) + COALESCE(job_postings_processed, 0)
      WHERE id = p_job_id;
    END IF;

    RETURN jsonb_build_object('success', true,
      'phase', CASE WHEN v_has_more THEN 'insert_jobs' ELSE 'done' END,
      'processed', v_window_count, 'signals_created', v_signals_created, 'has_more', v_has_more);
  END IF;

  RETURN jsonb_build_object('success', true, 'phase', v_job.phase, 'processed', 0, 'has_more', false);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_import_batch(p_batch_id uuid, p_chunk_size integer DEFAULT 5, p_max_iterations integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_batch_type TEXT; v_batch_status TEXT; v_total_rows INTEGER;
  v_processed INTEGER := 0; v_pending INTEGER; v_done INTEGER;
  v_total_processed INTEGER := 0; v_iteration INTEGER := 0;
  v_is_complete BOOLEAN; v_result JSONB;
BEGIN
  SELECT batch_type, status, total_rows INTO v_batch_type, v_batch_status, v_total_rows
  FROM public.import_batches WHERE id = p_batch_id;

  IF v_batch_type IS NULL THEN
    INSERT INTO public.debug_events (batch_id, event_type, message)
    VALUES (p_batch_id, 'error', 'Batch not found');
    RETURN jsonb_build_object('status','error','message','Batch not found',
      'total_processed',0,'pending_remaining',0,'iterations',0);
  END IF;

  IF v_batch_status = 'uploading' THEN
    RETURN jsonb_build_object('status','uploading','message','Batch is still being uploaded',
      'processed_this_call',0,'pending_remaining',-1,'iterations',0);
  END IF;

  WHILE v_iteration < p_max_iterations LOOP
    v_iteration := v_iteration + 1;
    SELECT COUNT(*) INTO v_pending FROM public.import_rows
    WHERE batch_id = p_batch_id AND status = 'pending';
    IF v_pending = 0 THEN EXIT; END IF;

    BEGIN
      IF v_batch_type = 'contacts' THEN
        v_processed := public.process_contact_batch_internal(p_batch_id, p_chunk_size);
      ELSIF v_batch_type = 'job_postings' THEN
        v_processed := public.process_job_batch_internal(p_batch_id, p_chunk_size);
      ELSE
        INSERT INTO public.debug_events (batch_id, event_type, message, details)
        VALUES (p_batch_id, 'error', 'Unknown batch type', json_build_object('batch_type', v_batch_type));
        EXIT;
      END IF;
      v_total_processed := v_total_processed + v_processed;
      IF v_processed < p_chunk_size THEN EXIT; END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.debug_events (batch_id, event_type, message, details)
      VALUES (p_batch_id, 'chunk_error', 'Error processing chunk',
        json_build_object('error', SQLERRM, 'iteration', v_iteration));
      EXIT;
    END;
  END LOOP;

  SELECT COUNT(*) INTO v_pending FROM public.import_rows
  WHERE batch_id = p_batch_id AND status = 'pending';
  SELECT COUNT(*) INTO v_done FROM public.import_rows
  WHERE batch_id = p_batch_id AND status IN ('processed','failed','skipped');

  v_is_complete := (v_pending = 0) AND (COALESCE(v_total_rows,0) = 0 OR v_done >= v_total_rows);

  UPDATE public.import_batches
  SET processed_rows = (SELECT COUNT(*) FROM public.import_rows WHERE batch_id = p_batch_id AND status='processed'),
      failed_rows    = (SELECT COUNT(*) FROM public.import_rows WHERE batch_id = p_batch_id AND status='failed'),
      skipped_rows   = (SELECT COUNT(*) FROM public.import_rows WHERE batch_id = p_batch_id AND status='skipped'),
      status = CASE WHEN v_is_complete THEN 'completed' ELSE 'processing' END,
      updated_at = timezone('utc'::text, now())
  WHERE id = p_batch_id;

  IF v_is_complete THEN
    INSERT INTO public.debug_events (batch_id, event_type, message, details)
    VALUES (p_batch_id, 'batch_completed', 'Batch processing completed',
      json_build_object('total_processed', v_total_processed, 'iterations', v_iteration));
    v_result := jsonb_build_object('status','completed','total_processed',v_total_processed,
      'pending_remaining',0,'iterations',v_iteration);
  ELSE
    v_result := jsonb_build_object('status','partial','processed_this_call',v_total_processed,
      'pending_remaining',v_pending,'iterations',v_iteration);
  END IF;

  RETURN v_result;
END; $function$
;

CREATE OR REPLACE FUNCTION public.process_job_batch_internal(p_batch_id uuid, p_limit integer DEFAULT 50)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_row RECORD;
  v_processed_count INTEGER := 0;
  v_retry_count INTEGER := 0;
  v_max_retries INTEGER := 3;
  v_retry_delay INTEGER;
  v_company_id UUID;
  v_job_id UUID;
BEGIN
  FOR v_row IN
    SELECT * FROM public.import_rows
    WHERE batch_id = p_batch_id AND status = 'pending'
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    v_retry_count := 0;

    <<retry_loop>>
    LOOP
      BEGIN
        v_company_id := public.upsert_company(
          COALESCE((v_row.row_data->>'company_name')::TEXT, (v_row.row_data->>'companyName')::TEXT, 'Unknown Company'),
          COALESCE((v_row.row_data->>'company_linkedin_url')::TEXT, (v_row.row_data->>'companyUrl')::TEXT),
          COALESCE((v_row.row_data->>'website')::TEXT, (v_row.row_data->>'companyUrl')::TEXT),
          (v_row.row_data->>'sector')::TEXT,
          COALESCE((v_row.row_data->>'country')::TEXT, (v_row.row_data->>'location')::TEXT),
          (v_row.row_data->>'logo_url')::TEXT,
          (v_row.row_data->>'company_description')::TEXT
        );

        -- job_url: unified single URL from any scraper field variant
        INSERT INTO public.job_postings (
          company_id, title, description, job_url, location,
          salary_range, posted_at, source_data
        ) VALUES (
          v_company_id,
          COALESCE((v_row.row_data->>'title')::TEXT, (v_row.row_data->>'job_title')::TEXT, 'Sin título'),
          COALESCE((v_row.row_data->>'description')::TEXT, (v_row.row_data->>'job_description')::TEXT, (v_row.row_data->>'html_job_description')::TEXT, ''),
          COALESCE(
            (v_row.row_data->>'job_url')::TEXT,
            (v_row.row_data->>'applyUrl')::TEXT,
            (v_row.row_data->>'apply_url')::TEXT,
            (v_row.row_data->>'apply_link')::TEXT,
            (v_row.row_data->>'jobUrl')::TEXT,
            (v_row.row_data->>'url')::TEXT,
            (v_row.row_data->>'uniq_id')::TEXT
          ),
          COALESCE((v_row.row_data->>'location')::TEXT, (v_row.row_data->>'city')::TEXT || ', ' || (v_row.row_data->>'country')::TEXT),
          COALESCE((v_row.row_data->>'salary')::TEXT, (v_row.row_data->>'salary_offered')::TEXT),
          COALESCE((v_row.row_data->>'postedTime')::TIMESTAMPTZ, (v_row.row_data->>'publishedAt')::TIMESTAMPTZ, (v_row.row_data->>'post_date')::TIMESTAMPTZ, now()),
          v_row.row_data
        )
        ON CONFLICT (job_url) DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          updated_at = now()
        WHERE job_postings.job_url IS NOT NULL
        RETURNING id INTO v_job_id;

        PERFORM public.process_job_signals(v_job_id);

        UPDATE public.import_rows
        SET status = 'processed', processed_at = timezone('utc'::text, now())
        WHERE id = v_row.id;

        v_processed_count := v_processed_count + 1;
        EXIT retry_loop;

      EXCEPTION
        WHEN serialization_failure OR deadlock_detected THEN
          v_retry_count := v_retry_count + 1;
          IF v_retry_count >= v_max_retries THEN
            INSERT INTO public.debug_events (batch_id, event_type, message, details)
            VALUES (p_batch_id, 'row_error', 'Error processing job row',
              jsonb_build_object('row_id', v_row.id, 'error', SQLERRM, 'retries_exhausted', v_retry_count));
            UPDATE public.import_rows SET status = 'failed', error_message = 'Deadlock after ' || v_retry_count || ' retries: ' || SQLERRM WHERE id = v_row.id;
            EXIT retry_loop;
          ELSE
            v_retry_delay := 10 * (5 ^ (v_retry_count - 1));
            INSERT INTO public.debug_events (batch_id, event_type, message, details)
            VALUES (p_batch_id, 'row_retry', 'Retrying job row after deadlock',
              jsonb_build_object('row_id', v_row.id, 'retry_count', v_retry_count, 'delay_ms', v_retry_delay));
            PERFORM pg_sleep(v_retry_delay::FLOAT / 1000.0);
            CONTINUE retry_loop;
          END IF;

        WHEN OTHERS THEN
          INSERT INTO public.debug_events (batch_id, event_type, message, details)
          VALUES (p_batch_id, 'row_error', 'Error processing job row',
            jsonb_build_object('row_id', v_row.id, 'error', SQLERRM));
          UPDATE public.import_rows SET status = 'failed', error_message = SQLERRM WHERE id = v_row.id;
          EXIT retry_loop;
      END;
    END LOOP;
  END LOOP;

  RETURN v_processed_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_job_signals(job_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_job RECORD;
  v_text_to_analyze TEXT;
  v_job_url TEXT;
  v_dict RECORD;
  v_matched_kw TEXT;
BEGIN
  SELECT * INTO v_job FROM public.job_postings WHERE id = job_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_text_to_analyze := COALESCE(v_job.title, '') || ' ' || COALESCE(v_job.description, '');

  -- Use job_url as the single URL source for signals
  v_job_url := COALESCE(
    v_job.source_data->>'applyUrl',
    v_job.source_data->>'apply_url',
    v_job.source_data->>'jobUrl',
    v_job.job_url
  );

  FOR v_dict IN SELECT dict_type, dict_id, pattern, keywords FROM public.dictionary_patterns_cache
  LOOP
    IF v_text_to_analyze ~* v_dict.pattern THEN
      SELECT kw INTO v_matched_kw
      FROM unnest(v_dict.keywords) kw
      WHERE v_text_to_analyze ~* ('\y' || public.escape_regex(kw) || '\y')
      LIMIT 1;

      IF v_matched_kw IS NOT NULL THEN
        INSERT INTO public.signals (company_id, signal_type, signal_id, keyword_matched, source_field, job_posting_id, snippet, source_url)
        VALUES (v_job.company_id, v_dict.dict_type, v_dict.dict_id, v_matched_kw, 'job_description', job_id, public.extract_snippet(v_text_to_analyze, v_matched_kw, 100), v_job_url)
        ON CONFLICT (job_posting_id, signal_type, signal_id) DO NOTHING;
      END IF;
    END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_pending_import_batches()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_batch_id UUID;
  v_batch_type TEXT;
  v_result JSON;
  v_total_processed INTEGER := 0;
  v_batches_processed INTEGER := 0;
BEGIN
  INSERT INTO public.debug_events (event_type, message)
  VALUES ('cron_start', 'Cron job started: processing pending batches');

  -- Procesar batches pending, uno a la vez
  FOR v_batch_id, v_batch_type IN
    SELECT id, batch_type
    FROM public.import_batches
    WHERE status IN ('pending', 'processing')
    ORDER BY created_at ASC
    LIMIT 5  -- Máximo 5 batches por ejecución del cron
  LOOP
    BEGIN
      -- Llamar a process_import_batch que ahora procesa en chunks
      v_result := public.process_import_batch(v_batch_id, 100);
      
      -- Extraer cuántas se procesaron
      IF v_result->>'status' = 'completed' THEN
        v_total_processed := v_total_processed + COALESCE((v_result->>'total_processed')::INTEGER, 0);
        v_batches_processed := v_batches_processed + 1;
      ELSIF v_result->>'status' = 'partial' THEN
        v_total_processed := v_total_processed + COALESCE((v_result->>'processed_this_call')::INTEGER, 0);
        -- Batch se completará en el próximo cron, es normal
      END IF;
      
      INSERT INTO public.debug_events (event_type, message, details)
      VALUES ('cron_batch_processed', 'Batch processed', 
        json_build_object('batch_id', v_batch_id, 'batch_type', v_batch_type, 'result', v_result));
      
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.debug_events (event_type, message, details)
      VALUES ('cron_batch_error', 'Error processing batch', 
        json_build_object('batch_id', v_batch_id, 'error', SQLERRM));
    END;
  END LOOP;

  INSERT INTO public.debug_events (event_type, message, details)
  VALUES ('cron_complete', 'Cron job completed', 
    json_build_object('total_processed', v_total_processed, 'batches_processed', v_batches_processed));

  RETURN json_build_object(
    'success', true,
    'total_processed', v_total_processed,
    'batches_processed', v_batches_processed
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_pending_queue(p_limit integer DEFAULT 100)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_batch_id UUID;
    v_result JSONB;
    v_total_processed INTEGER := 0;
    v_max_attempts INTEGER := 3;
    v_attempt INTEGER := 0;
BEGIN
    -- Find the oldest batch that has pending rows
    SELECT b.id INTO v_batch_id
    FROM public.import_batches b
    WHERE b.status IN ('pending', 'processing')
    AND EXISTS (
        SELECT 1 FROM public.import_rows r 
        WHERE r.batch_id = b.id 
        AND r.status = 'pending'
        LIMIT 1
    )
    ORDER BY b.created_at ASC
    LIMIT 1;

    IF v_batch_id IS NULL THEN
        RETURN 0;
    END IF;

    -- Process chunks of this batch
    WHILE v_attempt < v_max_attempts LOOP
        v_attempt := v_attempt + 1;
        
        BEGIN
            -- process_import_batch now returns JSONB
            v_result := public.process_import_batch(v_batch_id, p_limit);
            
            v_total_processed := v_total_processed + COALESCE(
              (v_result->>'processed_this_call')::INTEGER,
              (v_result->>'total_processed')::INTEGER,
              0
            );
            
            -- If batch completed or no more pending, stop
            IF v_result->>'status' = 'completed' OR 
               COALESCE((v_result->>'pending_remaining')::INTEGER, 0) = 0 THEN
                EXIT;
            END IF;
            
        EXCEPTION WHEN OTHERS THEN
            INSERT INTO public.debug_events (event_type, message, details)
            VALUES ('process_queue_error', 'Error in process_pending_queue', 
              jsonb_build_object('batch_id', v_batch_id, 'error', SQLERRM, 'attempt', v_attempt));
            EXIT;
        END;
    END LOOP;

    RETURN v_total_processed;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_pending_signals_batch(p_limit integer DEFAULT 50)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_signals_to_process pending_signals[];
  v_signal pending_signals;
  v_processed_count INTEGER := 0;
  v_total_processed INTEGER := 0;
BEGIN
  -- Obtener signals pendientes (ambos tipos)
  SELECT ARRAY_AGG(s.*) INTO v_signals_to_process
  FROM (
    SELECT * FROM public.pending_signals
    WHERE processed_at IS NULL
    ORDER BY created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ) s;

  -- Si no hay signals pendientes, simplemente retornar 0 sin loguear
  IF v_signals_to_process IS NULL OR array_length(v_signals_to_process, 1) IS NULL THEN
    RETURN 0;
  END IF;

  -- Procesar cada signal según su tipo
  FOREACH v_signal IN ARRAY v_signals_to_process LOOP
    BEGIN
      IF v_signal.signal_type = 'contact' AND v_signal.contact_id IS NOT NULL THEN
        PERFORM public.process_contact_signals(v_signal.contact_id);
        v_processed_count := 1;
        
      ELSIF v_signal.signal_type = 'job' AND v_signal.job_id IS NOT NULL THEN
        PERFORM public.process_job_signals(v_signal.job_id);
        v_processed_count := 1;
      ELSE
        v_processed_count := 0;
      END IF;

      -- Marcar como procesada
      UPDATE public.pending_signals 
      SET processed_at = timezone('utc'::text, now())
      WHERE id = v_signal.id;
      
      v_total_processed := v_total_processed + v_processed_count;

    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.debug_events (event_type, message, details)
      VALUES ('signal_error', 'Error processing signal', 
        jsonb_build_object('signal_id', v_signal.id, 'signal_type', v_signal.signal_type, 'error', SQLERRM));
      UPDATE public.pending_signals
      SET processed_at = timezone('utc'::text, now())
      WHERE id = v_signal.id;
    END;
  END LOOP;

  -- Solo loguear cuando procesamos algo
  IF v_total_processed > 0 THEN
    INSERT INTO public.debug_events (event_type, message, details)
    VALUES ('signals_batch_processed', 'Processed batch of signals', 
      jsonb_build_object('total_processed', v_total_processed, 'batch_size', p_limit));
  END IF;

  RETURN v_total_processed;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_remove_keyword(p_signal_id uuid, p_keyword text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  DELETE FROM public.signals 
  WHERE signal_id = p_signal_id 
    AND keyword_matched ILIKE p_keyword;
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_dictionary_patterns_cache()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  TRUNCATE public.dictionary_patterns_cache;

  INSERT INTO public.dictionary_patterns_cache (dict_type, dict_id, pattern, keywords)
  SELECT 'process', dp.id, public.build_combined_pattern(dp.keywords), dp.keywords
  FROM public.dictionary_processes dp;

  INSERT INTO public.dictionary_patterns_cache (dict_type, dict_id, pattern, keywords)
  SELECT 'technology', dp.id, public.build_combined_pattern(dp.keywords), dp.keywords
  FROM public.dictionary_products dp;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_landing_stats()
 RETURNS landing_stats
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contacts BIGINT;
  v_companies BIGINT;
  v_tech_proc INT;
  v_signals BIGINT;
  v_row public.landing_stats;
BEGIN
  SELECT COUNT(*) INTO v_contacts FROM public.contacts;
  SELECT COUNT(*) INTO v_companies FROM public.companies;
  SELECT
    (SELECT COUNT(*) FROM public.dictionary_products)
    + (SELECT COUNT(*) FROM public.dictionary_processes)
  INTO v_tech_proc;
  SELECT COUNT(*) INTO v_signals FROM public.signals;

  INSERT INTO public.landing_stats (
    id,
    contacts_analyzed,
    companies_indexed,
    technologies_processes,
    signals_detected,
    refreshed_at
  )
  VALUES (1, v_contacts, v_companies, v_tech_proc, v_signals, NOW())
  ON CONFLICT (id) DO UPDATE SET
    contacts_analyzed       = EXCLUDED.contacts_analyzed,
    companies_indexed       = EXCLUDED.companies_indexed,
    technologies_processes  = EXCLUDED.technologies_processes,
    signals_detected        = EXCLUDED.signals_detected,
    refreshed_at            = EXCLUDED.refreshed_at
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.release_cron_lock(p_lock_name text, p_holder text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ok BOOLEAN := FALSE;
BEGIN
  UPDATE public.cron_locks SET holder = NULL, locked_until = NULL
  WHERE lock_name = p_lock_name AND holder = p_holder RETURNING TRUE INTO v_ok;
  RETURN COALESCE(v_ok, FALSE);
END; $function$
;

CREATE OR REPLACE FUNCTION public.renew_cron_lock(p_lock_name text, p_holder text, p_ttl_secs integer DEFAULT 120)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ok BOOLEAN := FALSE;
BEGIN
  UPDATE public.cron_locks SET locked_until = now() + make_interval(secs => p_ttl_secs)
  WHERE lock_name = p_lock_name AND holder = p_holder RETURNING TRUE INTO v_ok;
  RETURN COALESCE(v_ok, FALSE);
END; $function$
;

CREATE OR REPLACE FUNCTION public.requeue_import_batch(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_pending INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_pending FROM public.import_rows
  WHERE batch_id = p_batch_id AND status = 'pending';

  IF v_pending = 0 THEN
    RETURN jsonb_build_object('status','noop','reason','no pending rows');
  END IF;

  UPDATE public.import_batches
  SET status = 'pending', consecutive_failures = 0, last_error = NULL,
      updated_at = timezone('utc', now())
  WHERE id = p_batch_id;

  RETURN jsonb_build_object('status','pending','pending_rows',v_pending);
END; $function$
;

CREATE OR REPLACE FUNCTION public.reset_batch_failures(p_batch_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE import_batches
  SET consecutive_failures = 0,
      last_error = NULL,
      updated_at = timezone('utc'::text, now())
  WHERE id = p_batch_id
    AND consecutive_failures > 0;
$function$
;

CREATE OR REPLACE FUNCTION public.revert_company_merge(p_merge_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'v3', 'pg_catalog'
AS $function$
DECLARE
  v_log      v3.company_merges;
  v_tbl      TEXT;
  v_ids      JSONB;
  v_restored INT := 0;
  v_cols     TEXT;
  v_cand     INT := 0;
  v_elem     JSONB;
  v_fm       JSONB;
  v_bm       JSONB;   -- [414]
BEGIN
  SELECT * INTO v_log FROM v3.company_merges WHERE id = p_merge_id;
  IF v_log.id IS NULL THEN
    RAISE EXCEPTION 'revert_company_merge: no existe el merge %', p_merge_id;
  END IF;
  IF v_log.reverted_at IS NOT NULL THEN
    RAISE EXCEPTION 'revert_company_merge: el merge % ya fue revertido', p_merge_id;
  END IF;

  SELECT string_agg(quote_ident(key), ', ') INTO v_cols
  FROM jsonb_each_text(v_log.duplicate_snapshot);

  EXECUTE format(
    'INSERT INTO public.companies (%s) SELECT %s FROM jsonb_populate_record(NULL::public.companies, $1)',
    v_cols, v_cols
  ) USING v_log.duplicate_snapshot;

  FOR v_tbl, v_ids IN SELECT key, value FROM jsonb_each(v_log.moved)
  LOOP
    EXECUTE format(
      'UPDATE %s SET %I = $1 WHERE id = ANY($2)',
      v_tbl,
      (SELECT a.attname
       FROM pg_constraint con
       JOIN pg_attribute a
         ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
       WHERE con.contype = 'f'
         AND con.confrelid = 'public.companies'::regclass
         AND con.conrelid = v_tbl::regclass
       LIMIT 1)
    ) USING v_log.duplicate_id,
            (SELECT array_agg((value #>> '{}')::uuid) FROM jsonb_array_elements(v_ids));
    v_restored := v_restored + jsonb_array_length(v_ids);
  END LOOP;

  FOR v_tbl, v_ids IN SELECT key, value FROM jsonb_each(v_log.deleted)
  LOOP
    SELECT string_agg(quote_ident(key), ', ') INTO v_cols
    FROM jsonb_each_text(v_ids->0);

    EXECUTE format(
      'INSERT INTO %s (%s) SELECT %s FROM jsonb_populate_recordset(NULL::%s, $1)',
      v_tbl, v_cols, v_cols, v_tbl
    ) USING v_ids;
    v_restored := v_restored + jsonb_array_length(v_ids);
  END LOOP;

  -- [NUEVO] Restaurar la cascada. Se recorre EN ORDEN (padre antes que hijo),
  -- por eso es un array y no un objeto: con jsonb_each el orden lo decide
  -- Postgres y las FKs fallarian.
  FOR v_elem IN
    SELECT value FROM jsonb_array_elements(coalesce(v_log.cascade_deleted, '[]'::jsonb))
  LOOP
    v_tbl  := v_elem->>'tabla';
    v_ids  := v_elem->'rows';

    SELECT string_agg(quote_ident(key), ', ') INTO v_cols
    FROM jsonb_each_text(v_ids->0);

    EXECUTE format(
      'INSERT INTO %s (%s) SELECT %s FROM jsonb_populate_recordset(NULL::%s, $1)
       ON CONFLICT DO NOTHING',
      v_tbl, v_cols, v_cols, v_tbl
    ) USING v_ids;
    v_restored := v_restored + jsonb_array_length(v_ids);
  END LOOP;

  -- [NUEVO] Deshacer la conciliacion de follows: sacar las suscripciones que
  -- se habian copiado al master y devolver su estado previo.
  FOR v_fm IN
    SELECT value FROM jsonb_array_elements(coalesce(v_log.follow_merge, '[]'::jsonb))
  LOOP
    DELETE FROM v3.followed_account_subscribers
    WHERE id = ANY (SELECT (value #>> '{}')::uuid
                      FROM jsonb_array_elements(v_fm->'subs_creados'));

    UPDATE v3.followed_account_subscribers
    SET subscribed = false, updated_at = now()
    WHERE id = ANY (SELECT (value #>> '{}')::uuid
                      FROM jsonb_array_elements(v_fm->'subs_reactivados'));

    UPDATE v3.followed_accounts f
    SET is_active         = (v_fm->'master_prev'->>'is_active')::boolean,
        refresh_day       = (v_fm->'master_prev'->>'refresh_day')::smallint,
        last_refreshed_at = (v_fm->'master_prev'->>'last_refreshed_at')::timestamptz,
        unfollowed_at     = (v_fm->'master_prev'->>'unfollowed_at')::timestamptz,
        unfollowed_by     = (v_fm->'master_prev'->>'unfollowed_by')::uuid,
        updated_at        = now()
    WHERE f.id = (v_fm->>'master_fa')::uuid;
  END LOOP;

  -- [414/417] Deshacer la consolidacion de bookmarks. La logica vive en
  -- v3.restore_bookmark_pair (script 417) porque la comparte con el revert de
  -- la limpieza historica: son ~40 lineas de EXECUTE format sobre 8 tablas
  -- hijas y tener dos copias garantizaba que se desincronicen.
  FOR v_bm IN
    SELECT value FROM jsonb_array_elements(coalesce(v_log.bookmark_merge, '[]'::jsonb))
  LOOP
    PERFORM v3.restore_bookmark_pair(v_bm);
  END LOOP;

  UPDATE v3.company_merges SET reverted_at = now() WHERE id = p_merge_id;

  WITH reabrir AS (
    UPDATE v3.company_dup_candidates d
    SET status = 'pending', merge_ids = NULL, resolved_at = NULL
    WHERE d.merge_ids @> ARRAY[p_merge_id]
      AND NOT EXISTS (
        SELECT 1 FROM v3.company_merges m
        WHERE m.id = ANY(d.merge_ids)
          AND m.id <> p_merge_id
          AND m.reverted_at IS NULL
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_cand FROM reabrir;

  RETURN jsonb_build_object(
    'merge_id',            p_merge_id,
    'restored_id',         v_log.duplicate_id,
    'restored_name',       v_log.duplicate_snapshot->>'name',
    'rows_restored',       v_restored,
    'candidates_reopened', v_cand
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_companies_by_name_filtered(p_query_text text, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, name text, logo_url text, country text, industry text, linkedin_url text, job_postings_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_normalized_query TEXT;
BEGIN
  -- Normalize the search input: lowercase + remove accents
  v_normalized_query := unaccent(LOWER(TRIM(p_query_text)));

  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.logo_url,
    c.country,
    c.industry,
    c.linkedin_url,
    (SELECT COUNT(*) FROM job_postings jp WHERE jp.company_id = c.id AND jp.is_active = true)::bigint AS job_postings_count
  FROM
    companies c
  WHERE
    c.normalized_name ILIKE '%' || v_normalized_query || '%'
    AND c.linkedin_url IS NOT NULL
    AND c.linkedin_url != ''
    AND EXISTS (
      SELECT 1 FROM signals s WHERE s.company_id = c.id
    )
  ORDER BY
    CASE WHEN c.normalized_name ILIKE v_normalized_query || '%' THEN 0 ELSE 1 END,
    length(c.name)
  LIMIT p_limit;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_companies_by_process(p_process_ids uuid[], p_countries text[] DEFAULT NULL::text[])
 RETURNS TABLE(company_id uuid, company_name text, company_logo_url text, company_website text, company_linkedin_url text, company_country text, signal_count bigint, job_postings_count bigint, sample_signals jsonb)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    c.id AS company_id,
    c.name AS company_name,
    c.logo_url AS company_logo_url,
    c.website AS company_website,
    c.linkedin_url AS company_linkedin_url,
    c.country AS company_country,
    COUNT(DISTINCT s.id) AS signal_count,
    -- Fixed: Only count job postings that have signals matching the search criteria
    (
      SELECT COUNT(DISTINCT jp.id)
      FROM job_postings jp
      INNER JOIN signals js ON js.job_posting_id = jp.id
      WHERE js.company_id = c.id
        AND js.signal_id = ANY(p_process_ids)  -- Filter by the specific process IDs being searched
        AND js.signal_type = 'process'
        AND jp.posted_at >= NOW() - INTERVAL '6 months'
    ) AS job_postings_count,
    jsonb_agg(
      DISTINCT jsonb_build_object(
        'keyword', s.keyword_matched,
        'contact_name', ct.full_name,
        'position', ct.current_position_title
      )
    ) FILTER (WHERE s.id IS NOT NULL) AS sample_signals
  FROM companies c
  INNER JOIN signals s ON s.company_id = c.id
  LEFT JOIN contacts ct ON s.contact_id = ct.id
  WHERE s.signal_id = ANY(p_process_ids)
    AND s.is_current_employee = TRUE
    AND (p_countries IS NULL OR c.country = ANY(p_countries))
  GROUP BY c.id
  HAVING COUNT(DISTINCT s.id) > 0
  ORDER BY signal_count DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_companies_by_process_v2(p_process_ids uuid[], p_countries text[] DEFAULT NULL::text[], p_exclude_providers boolean DEFAULT false, p_master_industry_ids text[] DEFAULT NULL::text[])
 RETURNS TABLE(company_id uuid, company_name text, company_country text, company_industry text, company_website text, company_logo_url text, master_industry_id text, master_industry_name text, signal_count bigint, current_count bigint, alumni_count bigint, job_count bigint, latest_signal_date timestamp with time zone, matched_processes text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  WITH company_signals AS (
    SELECT 
      s.company_id,
      COUNT(DISTINCT s.id) as signal_count,
      COUNT(DISTINCT s.contact_id) FILTER (WHERE s.is_current_employee = true AND s.contact_id IS NOT NULL) as current_count,
      COUNT(DISTINCT s.contact_id) FILTER (WHERE s.is_current_employee = false AND s.contact_id IS NOT NULL) as alumni_count,
      COUNT(DISTINCT s.job_posting_id) FILTER (WHERE s.job_posting_id IS NOT NULL) as job_count,
      MAX(s.created_at) as latest_signal_date,
      array_agg(DISTINCT dp.name) FILTER (WHERE dp.name IS NOT NULL) as matched_processes
    FROM signals s
    LEFT JOIN dictionary_processes dp ON s.signal_id = dp.id
    WHERE s.signal_type = 'process' 
      AND s.signal_id = ANY(p_process_ids)
    GROUP BY s.company_id
  )
  SELECT 
    c.id,
    c.name,
    c.country,
    c.industry,
    c.website,
    c.logo_url,
    c.master_industry_id,
    mi.name_es,
    cs.signal_count,
    cs.current_count,
    cs.alumni_count,
    cs.job_count,
    cs.latest_signal_date,
    cs.matched_processes
  FROM company_signals cs
  JOIN companies c ON c.id = cs.company_id
  LEFT JOIN master_industries mi ON c.master_industry_id = mi.id
  WHERE 
    (p_countries IS NULL OR c.country = ANY(p_countries))
    AND (NOT p_exclude_providers OR c.master_industry_id IS NULL OR c.master_industry_id != 'service_provider')
    AND (p_master_industry_ids IS NULL OR c.master_industry_id = ANY(p_master_industry_ids))
  ORDER BY cs.signal_count DESC, cs.current_count DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_companies_by_technology(p_product_id uuid, p_countries text[] DEFAULT NULL::text[])
 RETURNS TABLE(company_id uuid, company_name text, company_logo_url text, company_website text, company_linkedin_url text, company_country text, total_count bigint, current_count bigint, alumni_count bigint, job_postings_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  WITH company_signals AS (
    SELECT 
      c.id,
      c.name,
      c.logo_url,
      c.website,
      c.linkedin_url,
      c.country,
      -- Total signals for this product in this company
      COUNT(DISTINCT s.id) AS total_signals,
      -- Current employees: signals where is_current_employee = true
      COUNT(DISTINCT s.id) FILTER (WHERE s.is_current_employee = TRUE) AS current_employees,
      -- Alumni: contacts with this company in previous_positions that have tech signals for this company
      (
        SELECT COUNT(DISTINCT als.id)
        FROM contacts alc
        CROSS JOIN LATERAL jsonb_array_elements(alc.previous_positions) AS pp
        JOIN signals als ON als.contact_id = alc.id
        WHERE (pp->>'company_id')::uuid = c.id
        AND alc.current_company_id IS DISTINCT FROM c.id
        AND als.company_id = c.id
        AND als.signal_id = p_product_id
        AND als.signal_type = 'technology'
      ) AS alumni_signals,
      -- Job postings count: join through signals.job_posting_id
      (
        SELECT COUNT(DISTINCT jp.id)
        FROM job_postings jp
        INNER JOIN signals js ON js.job_posting_id = jp.id
        WHERE js.company_id = c.id
        AND js.signal_id = p_product_id
        AND jp.posted_at >= NOW() - INTERVAL '6 months'
      ) AS job_postings
    FROM companies c
    INNER JOIN signals s ON s.company_id = c.id
    WHERE s.signal_id = p_product_id
    AND (p_countries IS NULL OR c.country = ANY(p_countries))
    GROUP BY c.id, c.name, c.logo_url, c.website, c.linkedin_url, c.country
  )
  SELECT 
    cs.id AS company_id,
    cs.name AS company_name,
    cs.logo_url AS company_logo_url,
    cs.website AS company_website,
    cs.linkedin_url AS company_linkedin_url,
    cs.country AS company_country,
    cs.total_signals AS total_count,
    cs.current_employees AS current_count,
    cs.alumni_signals AS alumni_count,
    cs.job_postings AS job_postings_count
  FROM company_signals cs
  ORDER BY cs.total_signals DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_companies_by_technology_v2(p_product_id uuid, p_countries text[] DEFAULT NULL::text[], p_exclude_providers boolean DEFAULT false, p_master_industry_ids text[] DEFAULT NULL::text[])
 RETURNS TABLE(company_id uuid, company_name text, company_country text, company_industry text, company_website text, company_logo_url text, master_industry_id text, master_industry_name text, signal_count bigint, current_count bigint, alumni_count bigint, job_count bigint, latest_signal_date timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  WITH company_signals AS (
    SELECT 
      s.company_id,
      COUNT(DISTINCT s.id) as signal_count,
      COUNT(DISTINCT s.contact_id) FILTER (WHERE s.is_current_employee = true AND s.contact_id IS NOT NULL) as current_count,
      COUNT(DISTINCT s.contact_id) FILTER (WHERE s.is_current_employee = false AND s.contact_id IS NOT NULL) as alumni_count,
      COUNT(DISTINCT s.job_posting_id) FILTER (WHERE s.job_posting_id IS NOT NULL) as job_count,
      MAX(s.created_at) as latest_signal_date
    FROM signals s
    WHERE s.signal_type = 'technology' 
      AND s.signal_id = p_product_id
    GROUP BY s.company_id
  )
  SELECT 
    c.id,
    c.name,
    c.country,
    c.industry,
    c.website,
    c.logo_url,
    c.master_industry_id,
    mi.name_es,
    cs.signal_count,
    cs.current_count,
    cs.alumni_count,
    cs.job_count,
    cs.latest_signal_date
  FROM company_signals cs
  JOIN companies c ON c.id = cs.company_id
  LEFT JOIN master_industries mi ON c.master_industry_id = mi.id
  WHERE 
    (p_countries IS NULL OR c.country = ANY(p_countries))
    AND (NOT p_exclude_providers OR c.master_industry_id IS NULL OR c.master_industry_id != 'service_provider')
    AND (p_master_industry_ids IS NULL OR c.master_industry_id = ANY(p_master_industry_ids))
  ORDER BY cs.signal_count DESC, cs.current_count DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_normalize_country()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.country IS NOT NULL AND NEW.country != '' THEN
    NEW.country_normalized := normalize_country(NEW.country);
  ELSE
    NEW.country_normalized := NULL;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_refresh_patterns_cache()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.refresh_dictionary_patterns_cache();
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_admin_prompts_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_dictionary_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_icebreaker_templates_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION v3._explore_predicate(p_alias text, p_cols text[], p_like text[], p_regex text[])
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  col text;
  t   text;
  like_ors  text[] := '{}';
  regex_ors text[] := '{}';
begin
  if p_like is null or array_length(p_like, 1) is null then
    -- Sin terminos no hay busqueda de texto: predicado imposible para no devolver
    -- toda la tabla por error.
    return 'false';
  end if;

  foreach col in array p_cols loop
    foreach t in array p_like loop
      like_ors := like_ors || format('%I.%I ILIKE %L', p_alias, col, t);
    end loop;
    foreach t in array p_regex loop
      regex_ors := regex_ors || format('%I.%I ~* %L', p_alias, col, '\y' || t || '\y');
    end loop;
  end loop;

  return '(' || array_to_string(like_ors, ' OR ') || ') AND ('
             || array_to_string(regex_ors, ' OR ') || ')';
end;
$function$
;

CREATE OR REPLACE FUNCTION v3.apply_dup_candidate(p_candidate_id uuid, p_dry_run boolean DEFAULT false, p_decided_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'v3', 'pg_catalog'
AS $function$
DECLARE
  v_cand     v3.company_dup_candidates;
  v_dup      UUID;
  v_res      JSONB;
  v_merges   UUID[] := '{}';
  v_detalle  JSONB := '[]'::jsonb;
  v_movidas  INT := 0;
  v_borradas INT := 0;
BEGIN
  SELECT * INTO v_cand FROM v3.company_dup_candidates WHERE id = p_candidate_id;
  IF v_cand.id IS NULL THEN
    RAISE EXCEPTION 'apply_dup_candidate: no existe el candidato %', p_candidate_id;
  END IF;
  IF v_cand.status = 'merged' THEN
    RAISE EXCEPTION 'apply_dup_candidate: el candidato % ya fue mergeado', p_candidate_id;
  END IF;

  FOREACH v_dup IN ARRAY v_cand.company_ids LOOP
    CONTINUE WHEN v_dup = v_cand.master_id;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_dup);

    v_res := public.merge_companies(
      v_cand.master_id, v_dup, p_dry_run,
      CASE WHEN v_cand.status IN ('ai_same','ai_unsure') THEN 'ai' ELSE v_cand.method END,
      v_cand.ai_confidence, v_cand.ai_reasoning, p_decided_by
    );

    v_detalle  := v_detalle || v_res;
    v_movidas  := v_movidas + coalesce((v_res->>'moved_total')::int, 0);
    v_borradas := v_borradas + coalesce((v_res->>'deleted_total')::int, 0);

    IF NOT p_dry_run AND v_res->>'merge_id' IS NOT NULL THEN
      v_merges := v_merges || (v_res->>'merge_id')::uuid;
    END IF;
  END LOOP;

  IF NOT p_dry_run THEN
    UPDATE v3.company_dup_candidates
    SET status = 'merged', merge_ids = v_merges, resolved_at = now()
    WHERE id = p_candidate_id;
  END IF;

  RETURN jsonb_build_object(
    'candidate_id', p_candidate_id, 'dry_run', p_dry_run,
    'master_id', v_cand.master_id, 'merges', v_merges,
    'rows_moved', v_movidas, 'rows_deleted', v_borradas, 'detail', v_detalle
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION v3.auto_merge_safe_candidates(p_limit integer DEFAULT 500, p_dry_run boolean DEFAULT false, p_decided_by uuid DEFAULT NULL::uuid, p_budget_ms integer DEFAULT 2000, p_lock_ms integer DEFAULT 250)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'v3', 'pg_catalog'
AS $function$
DECLARE
  v_id        UUID;
  v_res       JSONB;
  v_grupos    INT := 0;
  v_movidas   INT := 0;
  v_borradas  INT := 0;
  v_errores   JSONB := '[]'::jsonb;
  v_inicio    TIMESTAMPTZ := clock_timestamp();
  v_corto     BOOLEAN := false;
  v_transcurr NUMERIC;
  v_trabados  INT := 0;
BEGIN
  -- lock_timeout SI funciona seteado adentro de la funcion, a diferencia de
  -- statement_timeout: no es un timer que arranca con la sentencia, es cuanto
  -- espera CADA pedido de lock. Por eso este SET LOCAL no es como el que se
  -- saco antes: aca el mecanismo es otro.
  --
  -- Para que sirve: si el ETL esta escribiendo las mismas filas, el merge espera
  -- indefinidamente. Con esto falla en 250ms, se saltea, y queda 'pending' para
  -- la proxima pasada.
  --
  -- OJO, no es la causa del outlier lento. Se probo la hipotesis de que el peor
  -- caso (5102ms moviendo solo 7 filas) era espera de lock y resulto FALSA:
  -- con lock_timeout activo el outlier siguio apareciendo y trabados=0.
  -- El costo tampoco esta en los UPDATE de las 25 tablas hijas: perfilados uno
  -- por uno suman 325ms para 60 candidatos (~5ms por candidato).
  -- Es 1 caso en ~200 y el peor caso se acota con p_budget_ms (ver arriba).
  -- Queda como red de seguridad barata, no como el fix del outlier.
  EXECUTE format('SET LOCAL lock_timeout = %L', p_lock_ms || 'ms');

  FOR v_id IN
    SELECT id FROM v3.company_dup_candidates
    WHERE classification = 'seguro' AND status = 'pending'
    ORDER BY created_at
    LIMIT p_limit
  LOOP
    -- Se chequea ANTES de cada merge, no despues: si ya no queda presupuesto
    -- para uno mas, se corta. Lo hecho hasta aca queda commiteado y el proximo
    -- clic sigue donde quedo (los mergeados ya no estan en 'pending').
    v_transcurr := extract(epoch FROM clock_timestamp() - v_inicio) * 1000;
    IF v_transcurr > p_budget_ms THEN
      v_corto := true;
      EXIT;
    END IF;

    BEGIN
      v_res := v3.apply_dup_candidate(v_id, p_dry_run, p_decided_by);
      v_grupos   := v_grupos + 1;
      v_movidas  := v_movidas + coalesce((v_res->>'rows_moved')::int, 0);
      v_borradas := v_borradas + coalesce((v_res->>'rows_deleted')::int, 0);
    EXCEPTION
      -- Trabado por otra transaccion (tipicamente el ETL). NO es un error del
      -- grupo: se deja en 'pending' a proposito para que el proximo clic lo
      -- reintente. Marcarlo 'failed' lo sacaria del lote para siempre por algo
      -- que era temporal.
      WHEN lock_not_available THEN
        v_trabados := v_trabados + 1;

      WHEN others THEN
        -- Un grupo que falla de verdad no puede frenar el lote entero.
        v_errores := v_errores || jsonb_build_object('candidate_id', v_id, 'error', SQLERRM);
        IF NOT p_dry_run THEN
          UPDATE v3.company_dup_candidates
          SET status = 'failed', error_message = SQLERRM
          WHERE id = v_id;
        END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run',      p_dry_run,
    'groups',       v_grupos,
    'rows_moved',   v_movidas,
    'rows_deleted', v_borradas,
    'errors',       v_errores,
    -- Salteados por lock, siguen 'pending'. Se informan aparte de los errores
    -- porque no requieren ninguna accion: se resuelven solos al reintentar.
    'trabados',     v_trabados,
    -- Para que la UI pueda decir "quedan N" y ofrecer seguir.
    'corto_por_tiempo', v_corto,
    'ms',           round(extract(epoch FROM clock_timestamp() - v_inicio) * 1000),
    'restantes',    (SELECT count(*) FROM v3.company_dup_candidates
                       WHERE classification = 'seguro' AND status = 'pending')
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION v3.bookmark_context_key(p_ctx jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT coalesce(
           (SELECT string_agg(x, ',' ORDER BY x COLLATE "C")
              FROM jsonb_array_elements_text(
                     CASE WHEN jsonb_typeof(p_ctx -> 'filterSignalIds') = 'array'
                          THEN p_ctx -> 'filterSignalIds'
                          ELSE '[]'::jsonb END) t(x)),
           '')
         || '|' ||
         coalesce(nullif(p_ctx ->> 'filterType', ''), 'generic');
$function$
;

CREATE OR REPLACE FUNCTION v3.bookmark_status_rank(p_status text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE p_status
           WHEN 'reunion'      THEN 5
           WHEN 'respondio'    THEN 4
           WHEN 'contactado'   THEN 3
           WHEN 'investigando' THEN 2
           WHEN 'nuevo'        THEN 1
           WHEN 'descartado'   THEN 0
           ELSE 0
         END;
$function$
;

CREATE OR REPLACE FUNCTION v3.build_dup_payload(p_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'v3', 'pg_catalog'
AS $function$
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'name'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'id',       c.id,
      'name',     c.name,
      'country',  nullif(btrim(coalesce(c.country, '')), ''),
      'industry', c.industry,
      'linkedin', nullif(regexp_replace(coalesce(c.linkedin_url, ''),
                    '^https?://([a-z]{2,3}\.)?linkedin\.com/company/', ''), ''),
      'website',  nullif(regexp_replace(coalesce(c.website, ''),
                    '^https?://(www\.)?', ''), ''),
      -- coalesce por si la empresa todavia no fue indexada (ETL recien corrido)
      'jobs',     coalesce(i.n_jobs, 0),
      'contacts', coalesce(i.n_contacts, 0),
      'news',     coalesce(i.n_news, 0),
      -- Para que la revision manual sepa que esta empresa es una cuenta seguida
      -- por alguien. Join contra una tabla chica e indexada por company_id.
      'follows',  coalesce(f.n, 0)
    ) AS x
    FROM public.companies c
    LEFT JOIN v3.company_name_index i ON i.company_id = c.id
    LEFT JOIN (
      SELECT company_id, count(*) AS n
      FROM v3.followed_accounts
      WHERE company_id = ANY(p_ids)
      GROUP BY company_id
    ) f ON f.company_id = c.id
    WHERE c.id = ANY(p_ids)
  ) s;
$function$
;

CREATE OR REPLACE FUNCTION v3.child_conflict_ids(p_tbl text, p_col text, p_master uuid, p_dup uuid)
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'v3', 'pg_catalog'
AS $function$
DECLARE
  v_idx     RECORD;
  v_pred    TEXT;
  v_cmp     TEXT;
  v_sql     TEXT;
  v_found   UUID[];
  v_all     UUID[] := ARRAY[]::UUID[];
  v_fk_attnum SMALLINT;
BEGIN
  SELECT a.attnum INTO v_fk_attnum
  FROM pg_attribute a
  WHERE a.attrelid = p_tbl::regclass AND a.attname = p_col AND NOT a.attisdropped;

  IF v_fk_attnum IS NULL THEN
    RETURN v_all;
  END IF;

  FOR v_idx IN
    SELECT i.indexrelid,
           i.indnullsnotdistinct AS nulls_no_distintos,
           pg_get_expr(i.indpred, i.indrelid) AS predicado,
           -- Solo las columnas CLAVE del indice: las de INCLUDE no participan
           -- de la restriccion de unicidad.
           (SELECT array_agg(k.attnum ORDER BY k.ord)
              FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
             WHERE k.ord <= i.indnkeyatts) AS key_attnums
    FROM pg_index i
    WHERE i.indrelid = p_tbl::regclass
      AND i.indisunique
      AND i.indisvalid
      -- Un indice con expresiones (indkey trae 0) no se puede comparar columna a
      -- columna. Se saltea a proposito: lo resuelve el fallback fila-por-fila.
      -- Es el caso de `bookmarks_user_company_context_uniq`, que ademas ya viene
      -- consolidado antes por v3.premerge_bookmarks.
      AND NOT (0 = ANY(i.indkey::int2[]))
  LOOP
    -- El indice tiene que incluir la columna FK entre sus columnas clave.
    CONTINUE WHEN NOT (v_fk_attnum = ANY(v_idx.key_attnums));

    -- Comparacion de las demas columnas clave. La FK se excluye porque despues
    -- del UPDATE la fila de la duplicada va a tener justamente el valor del
    -- master, o sea que ahi siempre coincide.
    --
    -- `=` implementa la semantica NULLS DISTINCT del UNIQUE por default: si un
    -- valor es NULL la comparacion da NULL, el EXISTS es falso y la fila no se
    -- marca. Que es lo correcto: con NULLS DISTINCT una fila con NULL nunca
    -- choca. Con NULLS NOT DISTINCT (PG15+) si choca, y ahi hace falta
    -- IS NOT DISTINCT FROM.
    SELECT string_agg(
             format('m.%1$I %2$s d.%1$I', a.attname,
                    CASE WHEN v_idx.nulls_no_distintos THEN 'IS NOT DISTINCT FROM' ELSE '=' END),
             ' AND ')
      INTO v_cmp
    FROM unnest(v_idx.key_attnums) AS k(attnum)
    JOIN pg_attribute a ON a.attrelid = p_tbl::regclass AND a.attnum = k.attnum
    WHERE k.attnum <> v_fk_attnum;

    -- Un unique que es solo (company_id) haria que toda fila del duplicado
    -- choque. No existe hoy, pero si existiera hay que dejarlo al fallback en
    -- vez de borrar todo.
    CONTINUE WHEN v_cmp IS NULL;

    -- Indice parcial: el UNIQUE solo aplica a las filas que cumplen el
    -- predicado, asi que se aplica a AMBOS lados. Se envuelve cada lado en una
    -- subconsulta de una sola tabla para que las referencias sin calificar del
    -- predicado (`contact_id IS NOT NULL`) resuelvan solas.
    --
    -- Verificado que los predicados de este esquema son estables al mover la FK
    -- (`source_url IS NOT NULL`, `contact_id IS NOT NULL`, y el de
    -- research_jobs pide `company_id IS NOT NULL`, que sigue valiendo porque
    -- master y duplicada son ambas no nulas). Si mañana apareciera un predicado
    -- que dependa del VALOR de company_id, esto habria que revisarlo.
    v_pred := CASE WHEN v_idx.predicado IS NULL THEN '' ELSE ' AND (' || v_idx.predicado || ')' END;

    v_sql := format(
      'SELECT coalesce(array_agg(DISTINCT d.id), ARRAY[]::uuid[])
         FROM (SELECT * FROM %1$s WHERE %2$I = $1%3$s) d
        WHERE EXISTS (
                SELECT 1 FROM (SELECT * FROM %1$s WHERE %2$I = $2%3$s) m
                 WHERE %4$s
              )',
      p_tbl, p_col, v_pred, v_cmp
    );

    EXECUTE v_sql INTO v_found USING p_dup, p_master;

    IF v_found IS NOT NULL AND array_length(v_found, 1) > 0 THEN
      SELECT array_agg(DISTINCT x) INTO v_all
      FROM unnest(v_all || v_found) AS t(x);
    END IF;
  END LOOP;

  RETURN coalesce(v_all, ARRAY[]::UUID[]);
END;
$function$
;

CREATE OR REPLACE FUNCTION v3.consolidate_bookmark_pair(p_keep uuid, p_drop uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'v3', 'pg_catalog'
AS $function$
DECLARE
  v_child   RECORD;
  v_moved   JSONB := '{}'::jsonb;
  v_deleted JSONB := '{}'::jsonb;
  v_ids     JSONB;
  v_rows    JSONB;
  v_drop    JSONB;
  v_prev    JSONB;
BEGIN
  IF p_keep = p_drop THEN
    RAISE EXCEPTION 'consolidate_bookmark_pair: keep y drop son el mismo bookmark (%)', p_keep;
  END IF;

  -- Fila que se borra y estado previo del sobreviviente, para el revert.
  SELECT to_jsonb(b) INTO v_drop FROM public.bookmarks b WHERE b.id = p_drop;
  IF v_drop IS NULL THEN
    RAISE EXCEPTION 'consolidate_bookmark_pair: no existe el bookmark a borrar (%)', p_drop;
  END IF;

  SELECT jsonb_build_object(
           'notes', b.notes, 'status', b.status,
           'priority', b.priority, 'updated_at', b.updated_at,
           'search_context', b.search_context)
    INTO v_prev
    FROM public.bookmarks b WHERE b.id = p_keep;
  IF v_prev IS NULL THEN
    RAISE EXCEPTION 'consolidate_bookmark_pair: no existe el sobreviviente (%)', p_keep;
  END IF;

  -- Mover todo lo que cuelga del bookmark. La lista sale de pg_constraint, no
  -- hardcodeada: hoy son 8 tablas y 4 estan en CASCADE (bookmark_summaries,
  -- user_icebreakers, user_company_strategies, user_company_signals), asi que
  -- borrar sin mover primero perderia contenido del usuario en silencio.
  FOR v_child IN
    SELECT (con.conrelid::regclass)::text AS tbl, a.attname AS col
    FROM pg_constraint con
    JOIN pg_attribute a
      ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.bookmarks'::regclass
      AND array_length(con.conkey, 1) = 1
    ORDER BY 1
  LOOP
    BEGIN
      EXECUTE format(
        'WITH upd AS (UPDATE %s SET %I = $1 WHERE %I = $2 RETURNING id)
         SELECT coalesce(jsonb_agg(id), ''[]''::jsonb) FROM upd',
        v_child.tbl, v_child.col, v_child.col
      ) INTO v_ids USING p_keep, p_drop;

      IF jsonb_array_length(v_ids) > 0 THEN
        v_moved := v_moved || jsonb_build_object(v_child.tbl, v_ids);
      END IF;

    EXCEPTION WHEN unique_violation THEN
      -- El sobreviviente ya tiene su propia fila (bookmark_summaries es UNIQUE
      -- (bookmark_id), user_company_strategies UNIQUE (bookmark_id, user_id)).
      -- Se conserva la del sobreviviente y la otra se guarda entera.
      EXECUTE format(
        'SELECT coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM %s t WHERE t.%I = $1',
        v_child.tbl, v_child.col
      ) INTO v_rows USING p_drop;

      EXECUTE format('DELETE FROM %s WHERE %I = $1', v_child.tbl, v_child.col)
        USING p_drop;

      IF jsonb_array_length(v_rows) > 0 THEN
        v_deleted := v_deleted || jsonb_build_object(v_child.tbl, v_rows);
      END IF;
    END;
  END LOOP;

  -- Conciliar el contenido propio. Las notas las escribio el usuario a mano:
  -- se concatenan, nunca se descarta una.
  UPDATE public.bookmarks k
  SET notes = CASE
                WHEN d.notes IS NULL OR btrim(d.notes) = '' THEN k.notes
                WHEN k.notes IS NULL OR btrim(k.notes) = '' THEN d.notes
                WHEN k.notes = d.notes THEN k.notes
                ELSE k.notes || E'\n\n---\n' || d.notes
              END,
      status = CASE
                 WHEN v3.bookmark_status_rank(d.status)
                      > v3.bookmark_status_rank(k.status)
                 THEN d.status ELSE k.status
               END,
      -- 'alta' / 'transaccional' / 'baja' no son una escala comparable, asi que
      -- solo se completa si el sobreviviente no tenia nada.
      priority = coalesce(k.priority, d.priority),
      -- countryFilter vive en search_context pero NO es identidad (la app decide
      -- duplicado solo por filterSignalIds + filterType). Es preferencia de
      -- vista: se hereda solo si el sobreviviente nunca eligio. Ojo con la
      -- convencion: key presente en null = "Todos los paises" a proposito,
      -- distinto de key ausente = no eligio.
      search_context = CASE
        WHEN (k.search_context ? 'countryFilter') THEN k.search_context
        WHEN (d.search_context ? 'countryFilter')
          THEN coalesce(k.search_context, '{}'::jsonb)
               || jsonb_build_object('countryFilter', d.search_context->'countryFilter')
        ELSE k.search_context
      END,
      updated_at = now()
  FROM public.bookmarks d
  WHERE k.id = p_keep AND d.id = p_drop;

  DELETE FROM public.bookmarks WHERE id = p_drop;

  RETURN jsonb_build_object(
    'keep_id',   p_keep,
    'drop_row',  v_drop,
    'keep_prev', v_prev,
    'moved',     v_moved,
    'deleted',   v_deleted
  );
END $function$
;

CREATE OR REPLACE FUNCTION v3.dedupe_bookmarks_legacy(p_limit integer DEFAULT 500, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'v3', 'pg_catalog'
AS $function$
DECLARE
  v_grupo    RECORD;
  v_drop     UUID;
  v_entry    JSONB;
  v_batch    UUID := gen_random_uuid();
  v_grupos   INTEGER := 0;
  v_filas    INTEGER := 0;
BEGIN
  FOR v_grupo IN
    SELECT user_id, company_id,
           v3.bookmark_context_key(search_context) AS ck,
           array_agg(id ORDER BY created_at, id) AS ids
    FROM public.bookmarks
    GROUP BY 1, 2, 3
    HAVING count(*) > 1
    ORDER BY user_id, company_id
    LIMIT p_limit
  LOOP
    v_grupos := v_grupos + 1;

    -- ids[1] es el mas viejo y sobrevive; el resto se consolidan sobre el.
    FOREACH v_drop IN ARRAY v_grupo.ids[2:]
    LOOP
      v_filas := v_filas + 1;
      IF NOT p_dry_run THEN
        v_entry := v3.consolidate_bookmark_pair(v_grupo.ids[1], v_drop);
        INSERT INTO v3.bookmark_dedupe_log (batch_id, keep_id, entry)
        VALUES (v_batch, v_grupo.ids[1], v_entry);
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run',   p_dry_run,
    'batch_id',  CASE WHEN p_dry_run THEN NULL ELSE v_batch END,
    'grupos',    v_grupos,
    'consolidados', v_filas
  );
END $function$
;

CREATE OR REPLACE FUNCTION v3.dismiss_dup_candidate(p_candidate_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'v3', 'pg_catalog'
AS $function$
  UPDATE v3.company_dup_candidates
  SET status = 'dismissed', resolved_at = now() WHERE id = p_candidate_id;
$function$
;

CREATE OR REPLACE FUNCTION v3.exclude_from_dup_candidate(p_candidate_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'v3', 'pg_catalog'
AS $function$
DECLARE
  v_ids   UUID[];
  v_nuevo UUID[];
BEGIN
  SELECT company_ids INTO v_ids
  FROM v3.company_dup_candidates WHERE id = p_candidate_id;

  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'exclude_from_dup_candidate: no existe el candidato %', p_candidate_id;
  END IF;

  SELECT array_agg(x) INTO v_nuevo
  FROM unnest(v_ids) AS x WHERE x <> p_company_id;

  IF v_nuevo IS NULL OR array_length(v_nuevo, 1) < 2 THEN
    UPDATE v3.company_dup_candidates
    SET status = 'dismissed', resolved_at = now()
    WHERE id = p_candidate_id;

    RETURN jsonb_build_object('candidate_id', p_candidate_id,
      'remaining', 0, 'dismissed', true);
  END IF;

  UPDATE v3.company_dup_candidates
  SET company_ids = v_nuevo,
      master_id   = public.pick_merge_master(v_nuevo),
      payload     = v3.build_dup_payload(v_nuevo)
  WHERE id = p_candidate_id;

  RETURN jsonb_build_object('candidate_id', p_candidate_id,
    'remaining', array_length(v_nuevo, 1), 'dismissed', false);
END;
$function$
;

CREATE OR REPLACE FUNCTION v3.explore_company_people(p_like text[], p_regex text[], p_company_id uuid, p_limit integer DEFAULT 25)
 RETURNS TABLE(full_name text, current_position_title text, headline text, linkedin_url text, country_normalized text, matched_terms text[], email1 text, phone1 text)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  pred text := v3._explore_predicate(
    'c',
    array['headline','about','current_position_title','current_position_description'],
    p_like, p_regex
  );
  -- Para "que termino matcheo cada persona" se evalua cada termino regex contra
  -- los campos de texto y se arma el array de los que dieron true.
  matched_expr text := '';
  t text;
  parts text[] := '{}';
begin
  if p_regex is null or array_length(p_regex, 1) is null then
    matched_expr := 'array[]::text[]';
  else
    foreach t in array p_regex loop
      parts := parts || format(
        'case when (c.headline ~* %L or c.about ~* %L or c.current_position_title ~* %L or c.current_position_description ~* %L) then %L end',
        '\y'||t||'\y', '\y'||t||'\y', '\y'||t||'\y', '\y'||t||'\y', t
      );
    end loop;
    matched_expr := 'array_remove(array[' || array_to_string(parts, ',') || '], null)';
  end if;

  return query execute format($q$
    select c.full_name,
           c.current_position_title,
           c.headline,
           c.linkedin_url,
           c.country_normalized,
           %s as matched_terms,
           c.email1,
           c.phone1
    from public.contacts c
    where c.current_company_id = %L and %s
    order by (c.email1 is not null) desc, c.full_name
    limit %s
  $q$, matched_expr, p_company_id, pred, p_limit);
end;
$function$
;

CREATE OR REPLACE FUNCTION v3.explore_geo_facets(p_like text[], p_regex text[], p_limit integer DEFAULT 30)
 RETURNS TABLE(country text, person_matches bigint)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  pred text := v3._explore_predicate(
    'c',
    array['headline','about','current_position_title','current_position_description'],
    p_like, p_regex
  );
begin
  return query execute format($q$
    select c.country_normalized, count(*)::bigint
    from public.contacts c
    where %s and c.country_normalized is not null and c.country_normalized <> ''
    group by c.country_normalized
    order by count(*) desc
    limit %s
  $q$, pred, p_limit);
end;
$function$
;

CREATE OR REPLACE FUNCTION v3.explore_industry_facets(p_like text[], p_regex text[], p_country text DEFAULT NULL::text, p_limit integer DEFAULT 30)
 RETURNS TABLE(master_industry_id text, name_es text, name_en text, person_matches bigint)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  pred text := v3._explore_predicate(
    'c',
    array['headline','about','current_position_title','current_position_description'],
    p_like, p_regex
  );
begin
  return query execute format($q$
    select co.master_industry_id::text,
           mi.name_es,
           mi.name_en,
           count(*)::bigint
    from public.contacts c
    join public.companies co on co.id = c.current_company_id
    left join public.master_industries mi on mi.id = co.master_industry_id
    where %s
      and (%L is null or c.country_normalized = %L)
    group by co.master_industry_id, mi.name_es, mi.name_en
    order by count(*) desc
    limit %s
  $q$, pred, p_country, p_country, p_limit);
end;
$function$
;

CREATE OR REPLACE FUNCTION v3.explore_search_companies(p_like text[], p_regex text[], p_country text DEFAULT NULL::text, p_industry_ids text[] DEFAULT NULL::text[], p_include_unclassified boolean DEFAULT true, p_search_contacts boolean DEFAULT true, p_search_jobs boolean DEFAULT true, p_limit integer DEFAULT 25)
 RETURNS TABLE(company_id uuid, company_name text, country_normalized text, master_industry_id text, industry_name_es text, person_matches bigint, job_matches bigint, total_matches bigint)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  contact_pred text := case when p_search_contacts then
    v3._explore_predicate('c',
      array['headline','about','current_position_title','current_position_description'],
      p_like, p_regex)
    else 'false' end;
  job_pred text := case when p_search_jobs then
    v3._explore_predicate('j', array['title','description'], p_like, p_regex)
    else 'false' end;
  -- Filtro de industria: si viene lista, se exige que la empresa este en ella;
  -- include_unclassified suma tambien las de master_industry_id NULL.
  industry_filter text;
begin
  if p_industry_ids is null or array_length(p_industry_ids, 1) is null then
    industry_filter := 'true';
  elsif p_include_unclassified then
    industry_filter := format('(co.master_industry_id::text = any(%L) or co.master_industry_id is null)', p_industry_ids);
  else
    industry_filter := format('co.master_industry_id::text = any(%L)', p_industry_ids);
  end if;

  return query execute format($q$
    with pc as (
      select c.current_company_id as company_id, count(*)::bigint as n
      from public.contacts c
      where %s and (%L is null or c.country_normalized = %L)
        and c.current_company_id is not null
      group by c.current_company_id
    ),
    jc as (
      select j.company_id, count(*)::bigint as n
      from public.job_postings j
      where %s and j.is_active and j.company_id is not null
      group by j.company_id
    )
    select co.id,
           co.name,
           co.country_normalized,
           co.master_industry_id::text,
           mi.name_es,
           coalesce(pc.n, 0) as person_matches,
           coalesce(jc.n, 0) as job_matches,
           coalesce(pc.n, 0) + coalesce(jc.n, 0) as total_matches
    from public.companies co
    left join pc on pc.company_id = co.id
    left join jc on jc.company_id = co.id
    left join public.master_industries mi on mi.id = co.master_industry_id
    where (pc.company_id is not null or jc.company_id is not null)
      and (%L is null or co.country_normalized = %L)
      and %s
    order by total_matches desc
    limit %s
  $q$, contact_pred, p_country, p_country, job_pred, p_country, p_country, industry_filter, p_limit);
end;
$function$
;

CREATE OR REPLACE FUNCTION v3.premerge_bookmarks(p_master uuid, p_duplicate uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'v3', 'pg_catalog'
AS $function$
DECLARE
  v_par RECORD;
  v_out JSONB := '[]'::jsonb;
BEGIN
  -- Atajo: hay 2.280 bookmarks sobre 485k empresas, asi que el 99% de los
  -- merges no tiene nada que hacer aca.
  IF NOT EXISTS (SELECT 1 FROM public.bookmarks WHERE company_id = p_duplicate) THEN
    RETURN v_out;
  END IF;

  FOR v_par IN
    -- Sobreviviente: el del master; si el master no tiene, el mas viejo.
    SELECT d.id AS drop_id, s.id AS keep_id
    FROM public.bookmarks d
    JOIN LATERAL (
      SELECT b.id
      FROM public.bookmarks b
      WHERE b.company_id = p_master
        AND b.user_id = d.user_id
        AND v3.bookmark_context_key(b.search_context)
            = v3.bookmark_context_key(d.search_context)
      ORDER BY b.created_at, b.id
      LIMIT 1
    ) s ON true
    WHERE d.company_id = p_duplicate
  LOOP
    v_out := v_out || jsonb_build_array(
      v3.consolidate_bookmark_pair(v_par.keep_id, v_par.drop_id)
    );
  END LOOP;

  RETURN v_out;
END $function$
;

CREATE OR REPLACE FUNCTION v3.premerge_followed_accounts(p_master uuid, p_dup uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'v3', 'pg_catalog'
AS $function$
DECLARE
  v_out     JSONB := '[]'::jsonb;
  r         RECORD;
  v_creados UUID[];
  v_flip    UUID[];
  v_prev    JSONB;
BEGIN
  FOR r IN
    SELECT fd.id AS dup_fa, fm.id AS master_fa, fd.workspace_id,
           fd.is_active AS dup_active, fd.refresh_day AS dup_day,
           fd.last_refreshed_at AS dup_last
    FROM v3.followed_accounts fd
    JOIN v3.followed_accounts fm
      ON fm.workspace_id = fd.workspace_id AND fm.company_id = p_master
    WHERE fd.company_id = p_dup
  LOOP
    SELECT to_jsonb(f) INTO v_prev
    FROM v3.followed_accounts f WHERE f.id = r.master_fa;

    -- Suscriptores que estaban en el duplicado y no en el master: se copian.
    -- Los originales se borran despues en cascada, pero quedan en el snapshot.
    WITH nuevos AS (
      INSERT INTO v3.followed_account_subscribers
        (followed_account_id, workspace_id, user_id, subscribed)
      SELECT r.master_fa, s.workspace_id, s.user_id, s.subscribed
      FROM v3.followed_account_subscribers s
      WHERE s.followed_account_id = r.dup_fa
        AND NOT EXISTS (
          SELECT 1 FROM v3.followed_account_subscribers m
           WHERE m.followed_account_id = r.master_fa AND m.user_id = s.user_id
        )
      RETURNING id
    )
    SELECT coalesce(array_agg(id), '{}'::uuid[]) INTO v_creados FROM nuevos;

    -- Ya estaba suscrito al master pero apagado, y en el duplicado prendido:
    -- gana el prendido (no se le saca una suscripcion que tenia).
    WITH flip AS (
      UPDATE v3.followed_account_subscribers m
      SET subscribed = true, updated_at = now()
      FROM v3.followed_account_subscribers s
      WHERE s.followed_account_id = r.dup_fa AND s.subscribed
        AND m.followed_account_id = r.master_fa AND m.user_id = s.user_id
        AND NOT m.subscribed
      RETURNING m.id
    )
    SELECT coalesce(array_agg(id), '{}'::uuid[]) INTO v_flip FROM flip;

    UPDATE v3.followed_accounts m
    SET is_active   = m.is_active OR r.dup_active,
        refresh_day = least(m.refresh_day, r.dup_day),
        -- Si alguno de los dos nunca se refresco, el unificado cuenta como
        -- nunca refrescado: el filtro cambio y conviene volver a scrapear.
        last_refreshed_at = CASE
          WHEN m.last_refreshed_at IS NULL OR r.dup_last IS NULL THEN NULL
          ELSE least(m.last_refreshed_at, r.dup_last)
        END,
        unfollowed_at = CASE WHEN m.is_active OR r.dup_active THEN NULL ELSE m.unfollowed_at END,
        unfollowed_by = CASE WHEN m.is_active OR r.dup_active THEN NULL ELSE m.unfollowed_by END,
        updated_at  = now()
    WHERE m.id = r.master_fa;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'workspace_id',      r.workspace_id,
      'dup_fa',            r.dup_fa,
      'master_fa',         r.master_fa,
      'master_prev',       v_prev,
      'subs_creados',      to_jsonb(v_creados),
      'subs_reactivados',  to_jsonb(v_flip)
    ));
  END LOOP;

  RETURN v_out;
END;
$function$
;

CREATE OR REPLACE FUNCTION v3.refresh_company_dup_candidates(p_limit integer DEFAULT 500, p_include_trgm boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'v3', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  v_nuevos  INT := 0;
  v_trgm    INT := 0;
BEGIN
  -- Ya no se agrupa nada aca: los grupos vienen precalculados por
  -- `sync_company_name_index()`. Esta funcion solo toma un lote pendiente,
  -- ordenado por peso, y arma el payload de esos pocos grupos.
  --
  -- Historial de lo que se probo y descarto, todo medido:
  --   - agrupar las 485k en el clic: 16s cache frio / 4,7s caliente -> el
  --     primer clic del dia fallaba igual. Inaceptable.
  --   - tablas temporales: 15s. Sin stats el planner degrada el join.
  WITH elegidos AS MATERIALIZED (
    SELECT g.group_key, g.company_ids AS ids, g.n, g.peso
    FROM v3.company_dup_groups g
    WHERE g.promoted_at IS NULL
      -- No re-proponer lo que ya se decidio (mergeado, descartado, en IA).
      AND NOT EXISTS (
        SELECT 1 FROM v3.company_dup_candidates d
        WHERE d.group_key = g.group_key AND d.method = 'core'
      )
    -- Se recorren TODAS las empresas (decision del usuario), pero las que no
    -- tienen contactos ni vacantes quedan al final de la cola por su peso.
    ORDER BY g.peso DESC, g.n DESC
    LIMIT p_limit
  ),
  miembros AS (
    SELECT e.group_key, c.id, c.linkedin_url, c.country, i.weight
    FROM elegidos e
    JOIN public.companies c ON c.id = ANY(e.ids)
    LEFT JOIN v3.company_name_index i ON i.company_id = c.id
  ),
  -- Los atributos que deciden si el grupo es ambiguo salen de companies, pero
  -- solo para los miembros de los grupos elegidos: pocas filas, por PK.
  atributos AS (
    SELECT group_key,
           count(DISTINCT linkedin_url) AS li_distintas,
           count(DISTINCT nullif(btrim(lower(country)), '')) AS paises
    FROM miembros
    GROUP BY group_key
  ),
  -- Grupos donde un mismo workspace sigue 2+ empresas del grupo. Unificar ahi
  -- fuerza a descartar uno de los dos follows (choca el UNIQUE workspace+empresa)
  -- y a decidir estado y suscriptores. Se preserva todo (script 412), pero es
  -- una decision de negocio: va a revision manual, no se auto-unifica.
  follows_en_conflicto AS (
    SELECT x.group_key
    FROM (
      SELECT mi.group_key, f.workspace_id, count(*) AS n
      FROM miembros mi
      JOIN v3.followed_accounts f ON f.company_id = mi.id
      GROUP BY mi.group_key, f.workspace_id
    ) x
    WHERE x.n > 1
    GROUP BY x.group_key
  ),
  -- Master elegido con el `weight` ya precalculado, en una sola pasada.
  -- `public.pick_merge_master()` hacia 3 subqueries por empresa (~4.500
  -- lookups por lote). No se la toca porque la usan los merges de v2.
  masters AS (
    SELECT DISTINCT ON (group_key) group_key, id AS master_id
    FROM miembros
    ORDER BY group_key, weight DESC NULLS LAST, id
  ),
  ins AS (
    INSERT INTO v3.company_dup_candidates
      (group_key, method, company_ids, master_id, classification, payload)
    SELECT
      e.group_key, 'core', e.ids, m.master_id,
      CASE
        WHEN a.li_distintas >= 2 OR a.paises >= 2 THEN 'ambiguo'
        WHEN fc.group_key IS NOT NULL THEN 'ambiguo'
        ELSE 'seguro'
      END,
      v3.build_dup_payload(e.ids)
    FROM elegidos e
    JOIN atributos a ON a.group_key = e.group_key
    JOIN masters   m ON m.group_key = e.group_key
    LEFT JOIN follows_en_conflicto fc ON fc.group_key = e.group_key
    ON CONFLICT (group_key, method) DO NOTHING
    RETURNING group_key
  ),
  -- Marcar los grupos ya promovidos: el indice parcial de la tabla los saca de
  -- la cola, asi el proximo clic arranca donde quedo este.
  marcados AS (
    UPDATE v3.company_dup_groups g
    SET promoted_at = now()
    WHERE g.group_key IN (SELECT group_key FROM ins)
    RETURNING 1
  )
  SELECT count(*) INTO v_nuevos FROM marcados;

  RETURN jsonb_build_object(
    'indexadas',       (SELECT count(*) FROM v3.company_name_index),
    'grupos_totales',  (SELECT count(*) FROM v3.company_dup_groups),
    'grupos_restantes',(SELECT count(*) FROM v3.company_dup_groups WHERE promoted_at IS NULL),
    'nuevos_grupos',   v_nuevos,
    'grupos_trgm',     v_trgm,
    'pendientes',      (SELECT count(*) FROM v3.company_dup_candidates WHERE status = 'pending'),
    'seguros',         (SELECT count(*) FROM v3.company_dup_candidates
                          WHERE status = 'pending' AND classification = 'seguro'),
    'ambiguos',        (SELECT count(*) FROM v3.company_dup_candidates
                          WHERE status = 'pending' AND classification = 'ambiguo')
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION v3.reserve_mcp_usage(p_workspace_id uuid, p_user_id uuid, p_api_key_id uuid, p_oauth_token_id uuid, p_request_id uuid, p_idempotency_key text, p_pool text, p_units integer, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'v3', 'public'
AS $function$
declare
  v_existing v3.mcp_usage_reservations; v_reusing boolean:=false;
  v_principal_id uuid;
  v_um int;v_ud int;v_uw int;v_wm int;v_wd int;v_ww int;
  v_ulm int;v_uld int;v_ulw int;v_wlm int;v_wld int;v_wlw int;
begin
  if p_units<1 then raise exception 'INVALID_UNITS'; end if;

  -- Exactamente un principal, igual que el CHECK de la tabla.
  if num_nonnulls(p_api_key_id, p_oauth_token_id) <> 1 then
    raise exception 'INVALID_MCP_PRINCIPAL:se espera exactamente un principal';
  end if;

  v_principal_id := coalesce(p_api_key_id, p_oauth_token_id);

  -- Validacion segun el tipo de credencial. En ambos casos se exige que el
  -- usuario siga siendo miembro activo del workspace, no solo que la credencial
  -- exista: una membresia revocada tiene que cortar el gasto al instante.
  if p_api_key_id is not null then
    if not exists(
      select 1 from v3.mcp_api_keys k
      join v3.workspace_members m
        on m.workspace_id=k.workspace_id and m.user_id=k.owner_user_id and m.status='active'
      where k.id=p_api_key_id and k.workspace_id=p_workspace_id
        and k.owner_user_id=p_user_id and k.revoked_at is null
    ) then raise exception 'INVALID_MCP_PRINCIPAL'; end if;
  else
    if not exists(
      select 1 from v3.mcp_oauth_tokens t
      join v3.workspace_members m
        on m.workspace_id=t.workspace_id and m.user_id=t.user_id and m.status='active'
      where t.id=p_oauth_token_id and t.workspace_id=p_workspace_id
        and t.user_id=p_user_id and t.revoked_at is null
        and t.expires_at > now()
    ) then raise exception 'INVALID_MCP_PRINCIPAL'; end if;
  end if;

  -- Idempotencia por principal, sin importar su tipo.
  select * into v_existing from v3.mcp_usage_reservations
   where principal_id=v_principal_id and pool=p_pool and idempotency_key=p_idempotency_key
   for update;
  v_reusing:=found;

  if v_reusing and v_existing.status<>'released' then
    return jsonb_build_object('allowed',true,'reservationId',v_existing.id,
      'idempotent',true,'status',v_existing.status,'metadata',v_existing.metadata);
  end if;

  if p_pool='research_server' then
    v_ulm:=2;v_uld:=10;v_ulw:=30;v_wlm:=3;v_wld:=20;v_wlw:=60;
  elsif p_pool='icebreaker_server' then
    v_ulm:=5;v_uld:=30;v_ulw:=100;v_wlm:=10;v_wld:=100;v_wlw:=300;
  elsif p_pool='research_client' then
    v_ulm:=5;v_uld:=25;v_ulw:=75;v_wlm:=10;v_wld:=75;v_wlw:=225;
  elsif p_pool='icebreaker_client' then
    v_ulm:=10;v_uld:=50;v_ulw:=150;v_wlm:=20;v_wld:=150;v_wlw:=450;
  elsif p_pool='apollo_enrichment' then
    -- 1 unidad = 1 contacto. Un run son hasta 10 contactos.
    v_ulm:=10;v_uld:=60;v_ulw:=200;v_wlm:=20;v_wld:=150;v_wlw:=500;
  else
    raise exception 'UNKNOWN_POOL:%', p_pool;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_pool,0));
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':'||p_pool,0));

  select coalesce(sum(units) filter(where created_at>=now()-interval '1 minute'),0),
         coalesce(sum(units) filter(where created_at>=date_trunc('day',now())),0),
         coalesce(sum(units) filter(where created_at>=date_trunc('week',now())),0)
    into v_um,v_ud,v_uw
    from v3.mcp_usage_reservations
   where user_id=p_user_id and pool=p_pool and status<>'released';

  select coalesce(sum(units) filter(where created_at>=now()-interval '1 minute'),0),
         coalesce(sum(units) filter(where created_at>=date_trunc('day',now())),0),
         coalesce(sum(units) filter(where created_at>=date_trunc('week',now())),0)
    into v_wm,v_wd,v_ww
    from v3.mcp_usage_reservations
   where workspace_id=p_workspace_id and pool=p_pool and status<>'released';

  if v_um+p_units>v_ulm or v_ud+p_units>v_uld or v_uw+p_units>v_ulw
   or v_wm+p_units>v_wlm or v_wd+p_units>v_wld or v_ww+p_units>v_wlw then
    return jsonb_build_object('allowed',false,'code','HARD_LIMIT_EXCEEDED',
      'remaining',jsonb_build_object(
        'userMinute',greatest(0,v_ulm-v_um),'userDay',greatest(0,v_uld-v_ud),
        'userWeek',greatest(0,v_ulw-v_uw),'workspaceMinute',greatest(0,v_wlm-v_wm),
        'workspaceDay',greatest(0,v_wld-v_wd),'workspaceWeek',greatest(0,v_wlw-v_ww)));
  end if;

  if v_reusing then
    update v3.mcp_usage_reservations
       set request_id=p_request_id,units=p_units,status='reserved',metadata=p_metadata,
           created_at=now(),committed_at=null,released_at=null
     where id=v_existing.id returning * into v_existing;
  else
    insert into v3.mcp_usage_reservations(
      workspace_id,user_id,api_key_id,oauth_token_id,request_id,idempotency_key,pool,units,metadata)
    values(p_workspace_id,p_user_id,p_api_key_id,p_oauth_token_id,p_request_id,p_idempotency_key,
           p_pool,p_units,p_metadata) returning * into v_existing;
  end if;

  return jsonb_build_object('allowed',true,'reservationId',v_existing.id,
    'idempotent',false,'status','reserved','metadata',v_existing.metadata);
end $function$
;

CREATE OR REPLACE FUNCTION v3.restore_bookmark_pair(p_entry jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'v3', 'pg_catalog'
AS $function$
DECLARE
  v_cols TEXT;
  v_tbl  RECORD;
BEGIN
  -- Reponer la fila borrada ANTES de devolverle las hijas: tienen FK al
  -- bookmark, asi que moverlas primero falla.
  --
  -- Las columnas se cruzan contra pg_attribute para excluir generadas: si mas
  -- adelante se agrega una columna GENERATED a `bookmarks`, `to_jsonb(b)` la
  -- captura y el INSERT explotaria con "cannot insert a non-DEFAULT value".
  SELECT string_agg(quote_ident(k.key), ', ') INTO v_cols
  FROM jsonb_object_keys(p_entry->'drop_row') AS k(key)
  JOIN pg_attribute a
    ON a.attrelid = 'public.bookmarks'::regclass
   AND a.attname = k.key
   AND a.attnum > 0
   AND NOT a.attisdropped
   AND a.attgenerated = '';

  EXECUTE format(
    'INSERT INTO public.bookmarks (%s)
     SELECT %s FROM jsonb_populate_record(NULL::public.bookmarks, $1)
     ON CONFLICT DO NOTHING',
    v_cols, v_cols
  ) USING p_entry->'drop_row';

  -- Si el INSERT no repuso nada, fue el UNIQUE de contexto (script 420). Pasa
  -- solo al revertir una consolidacion LEGACY: ahi los dos bookmarks estaban en
  -- la MISMA empresa, asi que reponer el borrado recrea exactamente el duplicado
  -- que ese indice prohibe. (Revertir un merge de empresas no tiene este
  -- problema: la fila vuelve a su empresa original, que el revert restaura.)
  --
  -- Sin este chequeo el DO NOTHING pasaba desapercibido y el error salia varias
  -- lineas despues, como violacion de FK al mover las hijas a un id inexistente.
  IF NOT EXISTS (
    SELECT 1 FROM public.bookmarks WHERE id = (p_entry->'drop_row'->>'id')::uuid
  ) THEN
    RAISE EXCEPTION
      'No se pudo reponer el bookmark %: choca contra bookmarks_user_company_context_uniq. '
      'Para revertir esta consolidacion hay que dropear ese indice, revertir, y recrearlo.',
      p_entry->'drop_row'->>'id';
  END IF;

  -- Hijas que se habian movido al sobreviviente.
  FOR v_tbl IN SELECT key AS tbl, value AS ids FROM jsonb_each(coalesce(p_entry->'moved','{}'::jsonb))
  LOOP
    EXECUTE format(
      'UPDATE %s SET bookmark_id = $1 WHERE id = ANY (SELECT (value #>> ''{}'')::uuid
         FROM jsonb_array_elements($2))',
      v_tbl.tbl
    ) USING (p_entry->'drop_row'->>'id')::uuid, v_tbl.ids;
  END LOOP;

  -- Hijas borradas por choque de unique.
  FOR v_tbl IN SELECT key AS tbl, value AS rows FROM jsonb_each(coalesce(p_entry->'deleted','{}'::jsonb))
  LOOP
    -- Mismo filtro de columnas generadas que arriba, por las mismas razones.
    SELECT string_agg(quote_ident(k.key), ', ') INTO v_cols
    FROM jsonb_object_keys(v_tbl.rows->0) AS k(key)
    JOIN pg_attribute a
      ON a.attrelid = v_tbl.tbl::regclass
     AND a.attname = k.key
     AND a.attnum > 0
     AND NOT a.attisdropped
     AND a.attgenerated = '';

    EXECUTE format(
      'INSERT INTO %s (%s) SELECT %s FROM jsonb_populate_recordset(NULL::%s, $1)
       ON CONFLICT DO NOTHING',
      v_tbl.tbl, v_cols, v_cols, v_tbl.tbl
    ) USING v_tbl.rows;
  END LOOP;

  -- Y devolver notas / estado / prioridad / contexto del sobreviviente.
  UPDATE public.bookmarks b
  SET notes    = p_entry->'keep_prev'->>'notes',
      status   = p_entry->'keep_prev'->>'status',
      priority = p_entry->'keep_prev'->>'priority',
      search_context = CASE
        WHEN NOT (p_entry->'keep_prev' ? 'search_context') THEN b.search_context
        WHEN p_entry->'keep_prev'->'search_context' = 'null'::jsonb THEN NULL
        ELSE p_entry->'keep_prev'->'search_context'
      END,
      updated_at = (p_entry->'keep_prev'->>'updated_at')::timestamptz
  WHERE b.id = (p_entry->>'keep_id')::uuid;
END $function$
;

CREATE OR REPLACE FUNCTION v3.revert_bookmark_dedupe(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'v3', 'pg_catalog'
AS $function$
DECLARE
  v_log   RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_log IN
    SELECT id, entry FROM v3.bookmark_dedupe_log
    WHERE batch_id = p_batch_id AND reverted_at IS NULL
    ORDER BY created_at DESC, id DESC
  LOOP
    PERFORM v3.restore_bookmark_pair(v_log.entry);
    UPDATE v3.bookmark_dedupe_log SET reverted_at = now() WHERE id = v_log.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('batch_id', p_batch_id, 'revertidos', v_count);
END $function$
;

CREATE OR REPLACE FUNCTION v3.search_companies_by_capability(p_product_ids uuid[] DEFAULT NULL::uuid[], p_process_ids uuid[] DEFAULT NULL::uuid[], p_countries text[] DEFAULT NULL::text[], p_master_industry_ids text[] DEFAULT NULL::text[], p_exclude_providers boolean DEFAULT true, p_mode text DEFAULT 'screening'::text, p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_product_ids IS NULL AND p_process_ids IS NULL THEN
    RAISE EXCEPTION 'CAPABILITY_SEARCH_NO_TERMS: hay que pasar al menos un producto o un proceso';
  END IF;
  IF p_mode NOT IN ('screening', 'detail') THEN
    RAISE EXCEPTION 'CAPABILITY_SEARCH_BAD_MODE: % (esperado screening|detail)', p_mode;
  END IF;

  -- TOPES DE TERMINOS: no son arbitrarios, salen de medir contra el limite de 8s
  -- que impone PostgREST (por donde entra el MCP).
  --
  -- El costo dominante NO es la CPU del agregado sino la LECTURA DE DISCO de
  -- public.signals (1,5M filas / 986 MB). Con cache caliente el agregado de los
  -- 3 procesos mas grandes corre en 365 ms; con cache frio la misma consulta
  -- tarda 6,6 s. O sea: el techo lo marca el peor caso frio, que es el que se
  -- va a dar en produccion cuando nadie consulto ese proceso hace rato.
  --
  -- Los procesos del diccionario son MUY gruesos: hay solo 23 y el mas grande
  -- ("Control administrativo financiero") tiene 183.072 señales. Medido frio:
  -- 1 proceso = 1,9 s | 2 = 6,1 s | 3 = 6,6 s | los 23 juntos = 22,5 s.
  -- Con 2 el peor caso queda en ~6 s, que entra en los 8 s con algo de aire.
  -- Se probo con 3 y daba 7,7 s: demasiado al filo.
  --
  -- OJO: filtrar por industria NO abarata la consulta (2 procesos + bancos =
  -- 5,6 s para 2.128 empresas), porque el escaneo de signals ocurre ANTES del
  -- join con companies. El filtro sirve para acotar el RESULTADO, no el costo.
  --
  -- Los productos son finos (73 en total): "todo Microsoft" son 10 productos y
  -- tarda 722 ms, asi que 20 es holgado.
  --
  -- No se puede resolver con SET LOCAL statement_timeout adentro de la funcion:
  -- no tiene efecto (ya verificado en este proyecto para las RPC de merge).
  --
  -- PENDIENTE (decision del dueño del proyecto): un indice
  -- (signal_type, signal_id) INCLUDE (company_id, contact_id, job_posting_id,
  -- is_current_employee, created_at) baja la lectura de disco 4,7x (47.682 ->
  -- 10.046 bloques) y permitiria subir el tope, pero pesa 153 MB sobre una
  -- tabla de v2 EN PRODUCCION. No se creo por precaucion.
  IF coalesce(array_length(p_process_ids, 1), 0) > 2 THEN
    RAISE EXCEPTION 'CAPABILITY_SEARCH_TOO_MANY_PROCESSES: % procesos (max 2). Los procesos son categorias muy amplias (el mas grande toca 60.757 empresas); buscá de a uno o dos.',
      array_length(p_process_ids, 1);
  END IF;
  IF coalesce(array_length(p_product_ids, 1), 0) > 20 THEN
    RAISE EXCEPTION 'CAPABILITY_SEARCH_TOO_MANY_PRODUCTS: % productos (max 20)', array_length(p_product_ids, 1);
  END IF;

  -- Una sola sentencia con CTEs. `filtered` se referencia varias veces (total,
  -- agregado por pais, agregado por industria), y Postgres materializa
  -- automaticamente un CTE referenciado mas de una vez, asi que el escaneo de
  -- public.signals ocurre UNA sola vez.
  --
  -- Se descarto la version con tabla temporal: obliga a marcar la funcion
  -- VOLATILE (Postgres rechaza INSERT/DELETE dentro de una funcion STABLE con
  -- "is not allowed in a non-volatile function") y agrega overhead de catalogo
  -- en cada llamada, sin ninguna ventaja sobre el CTE materializado.
  WITH matched AS (
    -- UNION ALL y no un OR con dos ANY: el OR obliga a un scan que no puede
    -- aprovechar idx_signals_signal_id en cada rama.
    SELECT s.company_id, s.id AS signal_row_id, s.contact_id, s.job_posting_id,
           s.is_current_employee, s.created_at, dp.name AS term
    FROM public.signals s
    JOIN public.dictionary_products dp ON dp.id = s.signal_id
    WHERE p_product_ids IS NOT NULL
      AND s.signal_type = 'technology'
      AND s.signal_id = ANY(p_product_ids)
    UNION ALL
    SELECT s.company_id, s.id, s.contact_id, s.job_posting_id,
           s.is_current_employee, s.created_at, dpr.name
    FROM public.signals s
    JOIN public.dictionary_processes dpr ON dpr.id = s.signal_id
    WHERE p_process_ids IS NOT NULL
      AND s.signal_type = 'process'
      AND s.signal_id = ANY(p_process_ids)
  ),
  per_company AS (
    SELECT
      m.company_id,
      -- count(*) y NO count(DISTINCT m.signal_row_id): `signals.id` es PRIMARY KEY,
      -- asi que el DISTINCT es redundante por definicion. No es cosmetico: obligaba
      -- a un `Sort Key: company_id, id` con `Sort Method: external merge Disk:
      -- 16952kB` (sort en DISCO), y era el verdadero cuello de botella de la rama
      -- de procesos. Verificado que ambas formas dan exactamente los mismos
      -- conteos (0 filas difieren sobre 105.369 empresas).
      count(*)::integer AS signals,
      count(DISTINCT m.contact_id) FILTER (
        WHERE m.is_current_employee = true AND m.contact_id IS NOT NULL)::integer AS current_employees,
      count(DISTINCT m.contact_id) FILTER (
        WHERE m.is_current_employee = false AND m.contact_id IS NOT NULL)::integer AS alumni,
      count(DISTINCT m.job_posting_id) FILTER (
        WHERE m.job_posting_id IS NOT NULL)::integer AS job_postings,
      max(m.created_at) AS latest_signal_at,
      array_agg(DISTINCT m.term) FILTER (WHERE m.term IS NOT NULL) AS matched_terms
    FROM matched m
    GROUP BY m.company_id
  ),
  filtered AS (
    SELECT
      pc.company_id,
      c.name AS company_name,
      -- public.companies.country mezcla NULL y string vacio para el mismo caso
      -- (pais desconocido). Sin este nullif el screening devolvia DOS entradas
      -- distintas -- "(sin pais)" con 1754 empresas y "" con 1210 -- que se
      -- quedaban con los dos primeros puestos del ranking y empujaban a los
      -- paises reales fuera del top 5 que lee el modelo.
      nullif(btrim(c.country), '') AS country,
      c.master_industry_id AS industry_id,
      mi.name_es AS industry_name,
      c.website,
      pc.signals, pc.current_employees, pc.alumni, pc.job_postings,
      pc.latest_signal_at, pc.matched_terms
    FROM per_company pc
    JOIN public.companies c ON c.id = pc.company_id
    LEFT JOIN public.master_industries mi ON mi.id = c.master_industry_id
    -- El filtro compara contra el pais YA normalizado y sin distinguir
    -- mayusculas, para que el modelo pueda reenviar tal cual el nombre que le
    -- devolvio el screening ("Argentina", "Costa Rica") sin depender de como
    -- quedo escrito en la fila.
    WHERE (p_countries IS NULL OR lower(btrim(c.country)) = ANY(
             SELECT lower(btrim(x)) FROM unnest(p_countries) AS x))
      AND (p_master_industry_ids IS NULL OR c.master_industry_id = ANY(p_master_industry_ids))
      -- IS DISTINCT FROM conserva las de industria NULL, igual que la RPC de v2.
      -- Son 3197 empresas en el peor caso: descartarlas perderia prospectos reales.
      AND (NOT p_exclude_providers OR c.master_industry_id IS DISTINCT FROM 'service_provider')
  ),
  totals AS (
    SELECT count(*)::integer AS total_companies,
           coalesce(sum(signals), 0)::integer AS total_signals
    FROM filtered
  )
  SELECT CASE WHEN p_mode = 'screening' THEN
    -- Sin nombres de empresa a proposito: el objetivo es que el modelo sepa
    -- CUANTO hay y DONDE esta para pedirle al usuario que acote, sin gastar
    -- contexto en 1681 filas.
    jsonb_build_object(
      'mode', 'screening',
      'totalCompanies', t.total_companies,
      'totalSignals', t.total_signals,
      'byCountry', coalesce((
        SELECT jsonb_agg(x) FROM (
          SELECT coalesce(f.country, '(sin pais)') AS country,
                 count(*)::integer AS companies,
                 sum(f.signals)::integer AS signals
          FROM filtered f GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 20
        ) x), '[]'::jsonb),
      'byIndustry', coalesce((
        SELECT jsonb_agg(y) FROM (
          SELECT coalesce(f.industry_id, '(sin industria)') AS "industryId",
                 coalesce(f.industry_name, '(sin clasificar)') AS industry,
                 count(*)::integer AS companies,
                 sum(f.signals)::integer AS signals
          FROM filtered f GROUP BY 1, 2 ORDER BY count(*) DESC, 2 LIMIT 20
        ) y), '[]'::jsonb)
    )
  ELSE
    jsonb_build_object(
      'mode', 'detail',
      'totalCompanies', t.total_companies,
      'totalSignals', t.total_signals,
      'returned', least(t.total_companies, p_limit),
      'truncated', t.total_companies > p_limit,
      'companies', coalesce((
        SELECT jsonb_agg(z) FROM (
          SELECT f.company_id AS "companyId",
                 f.company_name AS name,
                 f.country,
                 f.industry_id AS "industryId",
                 f.industry_name AS industry,
                 f.website,
                 f.signals,
                 f.current_employees AS "currentEmployees",
                 f.alumni,
                 f.job_postings AS "jobPostings",
                 f.latest_signal_at AS "latestSignalAt",
                 f.matched_terms AS "matchedTerms"
          FROM filtered f
          ORDER BY f.signals DESC, f.current_employees DESC, f.company_name
          LIMIT p_limit
        ) z), '[]'::jsonb)
    )
  END
  INTO v_result
  FROM totals t;

  RETURN v_result;
END;
$function$
;

CREATE OR REPLACE FUNCTION v3.search_companies_ranked(p_query text, p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH q AS (
  -- Se limpian comas porque los nombres de razon social las traen ("Arcor, S.A.")
  -- y el usuario no las escribe igual.
  SELECT btrim(replace(coalesce(p_query, ''), ',', '')) AS t
),
matches AS (
  SELECT
    c.id, c.name, c.normalized_name, c.website, c.country, c.industry,
    -- OJO: en `companies` el dominio faltante viene como string vacio, no como
    -- NULL. Un `website IS NOT NULL` pelado da true con '' y marcaba como
    -- "tiene dominio" a registros degradados, que es justo la senal que el modelo
    -- usa para descartarlos. Se calcula una sola vez y se reusa en los ORDER BY
    -- y en el payload, para que el desempate y lo que se informa no se separen.
    (c.website IS NOT NULL AND btrim(c.website) <> '') AS has_website,
    CASE
      WHEN lower(c.name) = lower((SELECT t FROM q)) THEN 0
      WHEN c.name ILIKE (SELECT t FROM q) || '%' THEN 1
      WHEN c.name ILIKE '%' || (SELECT t FROM q) || '%' THEN 2
      ELSE 3
    END AS tier
  FROM public.companies c
  WHERE (SELECT t FROM q) <> ''
    AND (c.name ILIKE '%' || (SELECT t FROM q) || '%'
      OR c.website ILIKE '%' || (SELECT t FROM q) || '%')
),
-- Total REAL de coincidencias, antes de cualquier recorte. Es el numero que el
-- modelo necesita para avisarle al usuario cuantos homonimos hay.
total AS (SELECT count(*)::int AS n FROM matches),
pool AS (
  SELECT * FROM matches
  ORDER BY tier, name, id
  LIMIT least(greatest(p_limit * 10, 100), 300)
),
scored AS (
  SELECT
    p.*,
    (SELECT count(*) FROM public.signals s WHERE s.company_id = p.id) AS signals,
    (SELECT count(*) FROM public.job_postings j WHERE j.company_id = p.id) AS job_postings
  FROM pool p
),
ranked AS (
  SELECT * FROM scored
  -- Primero las que coinciden por nombre: una empresa que solo matcheo por su URL
  -- casi nunca es la que el usuario busca.
  ORDER BY (tier <= 2) DESC, signals DESC, job_postings DESC,
           has_website DESC, name, id
  LIMIT greatest(p_limit, 1)
)
SELECT jsonb_build_object(
  'totalMatches', (SELECT n FROM total),
  'companies', coalesce(
    (SELECT jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'name', r.name,
          'normalized_name', r.normalized_name,
          'website', r.website,
          'country', r.country,
          'industry', r.industry,
          -- Distingue coincidencia de nombre de matcheo por URL. Lo usa
          -- `likelyCanonical` para no proponer Sodimac cuando se busca Falabella.
          'nameMatch', r.tier <= 2,
          'evidence', jsonb_build_object(
            'signals', r.signals,
            'jobPostings', r.job_postings,
            'hasWebsite', r.has_website
          )
        )
        ORDER BY (r.tier <= 2) DESC, r.signals DESC, r.job_postings DESC,
                 r.has_website DESC, r.name, r.id
      )
     FROM ranked r),
    '[]'::jsonb)
);
$function$
;

CREATE OR REPLACE FUNCTION v3.snapshot_cascade(p_tbl text, p_ids uuid[], p_depth integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'v3', 'pg_catalog'
AS $function$
DECLARE
  v_out       JSONB := '[]'::jsonb;
  v_child     RECORD;
  v_rows      JSONB;
  v_child_ids UUID[];
  v_tiene_id  BOOLEAN;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Corte de seguridad ante ciclos de FKs.
  IF p_depth > 5 THEN
    RETURN '[]'::jsonb;
  END IF;

  FOR v_child IN
    SELECT (con.conrelid::regclass)::text AS tbl,
           (SELECT a.attname
              FROM pg_attribute a
             WHERE a.attrelid = con.conrelid AND a.attnum = con.conkey[1]) AS col,
           con.conrelid AS rel
    FROM pg_constraint con
    WHERE con.contype = 'f'
      AND con.confrelid = p_tbl::regclass
      AND con.confdeltype = 'c'                 -- solo CASCADE
      AND array_length(con.conkey, 1) = 1
      AND con.conrelid <> p_tbl::regclass       -- ignorar self-FK
    ORDER BY 1
  LOOP
    -- Sin columna `id` no se puede recursar; se guarda igual pero sin bajar mas.
    SELECT EXISTS (
      SELECT 1 FROM pg_attribute
       WHERE attrelid = v_child.rel AND attname = 'id' AND attnum > 0
    ) INTO v_tiene_id;

    IF v_tiene_id THEN
      EXECUTE format(
        'SELECT coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb),
                coalesce(array_agg(t.id), ''{}''::uuid[])
           FROM %s t WHERE t.%I = ANY($1)',
        v_child.tbl, v_child.col
      ) INTO v_rows, v_child_ids USING p_ids;
    ELSE
      EXECUTE format(
        'SELECT coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb)
           FROM %s t WHERE t.%I = ANY($1)',
        v_child.tbl, v_child.col
      ) INTO v_rows USING p_ids;
      v_child_ids := '{}'::uuid[];
    END IF;

    IF jsonb_array_length(v_rows) > 0 THEN
      -- El padre va antes que sus hijos: asi se puede restaurar en orden.
      v_out := v_out || jsonb_build_array(
        jsonb_build_object('tabla', v_child.tbl, 'rows', v_rows)
      );
      v_out := v_out || v3.snapshot_cascade(v_child.tbl, v_child_ids, p_depth + 1);
    END IF;
  END LOOP;

  RETURN v_out;
END;
$function$
;

CREATE OR REPLACE FUNCTION v3.sync_company_name_index(p_limit integer DEFAULT 50000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'v3', 'pg_catalog'
AS $function$
DECLARE
  v_altas    INT := 0;
  v_cambios  INT := 0;
  v_bajas    INT := 0;
  v_pesos    INT := 0;
  v_grupos   INT := 0;
  v_inicio   TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- 1. Altas: empresas nuevas que el ETL trajo y todavia no estan indexadas.
  WITH nuevas AS (
    SELECT c.id, c.name
    FROM public.companies c
    LEFT JOIN v3.company_name_index i ON i.company_id = c.id
    WHERE i.company_id IS NULL
    LIMIT p_limit
  ), ins AS (
    INSERT INTO v3.company_name_index (company_id, name_snapshot, core)
    SELECT n.id, n.name, public.company_core_name(n.name)
    FROM nuevas n
    ON CONFLICT (company_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_altas FROM ins;

  -- 2. Renombres: solo aca se vuelve a pagar el regex, y solo por las que
  --    efectivamente cambiaron de nombre.
  WITH cambiadas AS (
    SELECT c.id, c.name
    FROM public.companies c
    JOIN v3.company_name_index i ON i.company_id = c.id
    WHERE i.name_snapshot <> c.name
    LIMIT p_limit
  ), upd AS (
    UPDATE v3.company_name_index i
    SET name_snapshot = ch.name,
        core          = public.company_core_name(ch.name),
        refreshed_at  = now()
    FROM cambiadas ch
    WHERE i.company_id = ch.id
    RETURNING 1
  )
  SELECT count(*) INTO v_cambios FROM upd;

  -- 3. Bajas: huerfanos que quedaron porque no hay FK (decision deliberada).
  WITH borradas AS (
    DELETE FROM v3.company_name_index i
    WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = i.company_id)
    RETURNING 1
  )
  SELECT count(*) INTO v_bajas FROM borradas;

  -- 4. Counts: con agregados en una sola pasada. Buscar empresa por empresa
  --    costaba 9s (484.895 lookups); asi cuesta ~2s.
  --    Se guardan desagregados porque `build_dup_payload` los necesita para la
  --    UI, y consultarlos por empresa era lo que hacia fallar el boton.
  WITH counts AS (
    SELECT id,
           sum(jobs)::int     AS jobs,
           sum(contactos)::int AS contactos,
           sum(noticias)::int  AS noticias
    FROM (
      SELECT current_company_id AS id, 0 AS jobs, count(*) AS contactos, 0 AS noticias
      FROM public.contacts WHERE current_company_id IS NOT NULL
      GROUP BY current_company_id
      UNION ALL
      SELECT company_id AS id, count(*) AS jobs, 0 AS contactos, 0 AS noticias
      FROM public.job_postings WHERE company_id IS NOT NULL
      GROUP BY company_id
      UNION ALL
      SELECT company_id AS id, 0 AS jobs, 0 AS contactos, count(*) AS noticias
      FROM public.company_news WHERE company_id IS NOT NULL
      GROUP BY company_id
    ) u GROUP BY id
  ), upd AS (
    UPDATE v3.company_name_index i
    SET weight     = c.contactos + c.jobs,
        n_jobs     = c.jobs,
        n_contacts = c.contactos,
        n_news     = c.noticias
    FROM counts c
    WHERE i.company_id = c.id
      AND (i.weight <> c.contactos + c.jobs
        OR i.n_jobs <> c.jobs
        OR i.n_contacts <> c.contactos
        OR i.n_news <> c.noticias)
    RETURNING 1
  )
  SELECT count(*) INTO v_pesos FROM upd;

  -- 5. Recalcular los grupos. Es la parte cara (16s con cache frio) y por eso
  --    vive aca, en la sincronizacion pesada, y no en el clic del boton.
  --    Se preserva `promoted_at` para no volver a proponer lo ya decidido.
  WITH nuevos AS (
    SELECT core AS group_key,
           array_agg(company_id ORDER BY company_id) AS ids,
           count(*)::int AS n,
           sum(weight)::bigint AS peso
    FROM v3.company_name_index
    WHERE core IS NOT NULL AND length(core) >= 3
    GROUP BY core
    HAVING count(*) > 1
  ), up AS (
    INSERT INTO v3.company_dup_groups (group_key, company_ids, n, peso)
    SELECT group_key, ids, n, peso FROM nuevos
    ON CONFLICT (group_key) DO UPDATE
      SET company_ids = EXCLUDED.company_ids,
          n           = EXCLUDED.n,
          peso        = EXCLUDED.peso,
          detected_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_grupos FROM up;

  -- Grupos que dejaron de serlo (quedo una sola empresa tras un merge).
  -- El UPSERT de arriba puso `detected_at = now()` en todos los vigentes, asi
  -- que los que quedaron con timestamp viejo ya no son grupos. Es un filtro por
  -- fecha y nada mas.
  --
  -- La primera version hacia `NOT EXISTS (... GROUP BY ... HAVING count(*)>1)`
  -- correlacionado: un agregado sobre el indice por cada uno de los 21.508
  -- grupos. Se colgo a los 120s.
  DELETE FROM v3.company_dup_groups
  WHERE promoted_at IS NULL AND detected_at < v_inicio;

  RETURN jsonb_build_object(
    'altas', v_altas, 'renombres', v_cambios,
    'bajas', v_bajas, 'pesos_actualizados', v_pesos,
    'grupos_detectados', v_grupos,
    'total_indexadas', (SELECT count(*) FROM v3.company_name_index),
    -- Si quedan pendientes, hay que volver a llamar: el lote esta acotado.
    'quedan_pendientes', (
      SELECT count(*) FROM public.companies c
      LEFT JOIN v3.company_name_index i ON i.company_id = c.id
      WHERE i.company_id IS NULL
    )
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION v3.user_workspace_id(user_uuid uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT workspace_id FROM v3.workspace_members 
  WHERE user_id = user_uuid AND status = 'active'
  LIMIT 1;
$function$
;

-- ============ VIEWS ============
create or replace view public.apollo_reverify_candidates as  SELECT id,
    user_id,
    company_id,
    apollo_person_id,
    linkedin_url,
    full_name,
    last_verified_at,
    EXTRACT(epoch FROM now() - last_verified_at) / 86400::numeric AS days_since_verified
   FROM user_company_contacts
  WHERE apollo_person_id IS NOT NULL AND source = 'apollo'::text AND (last_verified_at IS NULL OR last_verified_at < (now() - '90 days'::interval)) AND (status IS NULL OR status <> 'archived'::text);

create or replace view public.apollo_title_catalog_ranked as  SELECT normalized_title,
    display_title,
    language,
    seniority,
    department,
    aliases,
    usage_count,
    success_count,
        CASE
            WHEN success_count > 0 THEN 'verified'::text
            WHEN usage_count > 0 THEN 'seen'::text
            ELSE 'inferred'::text
        END AS status
   FROM apollo_title_catalog
  ORDER BY success_count DESC, usage_count DESC;

create or replace view public.import_batches_inconsistent as  SELECT b.id,
    b.filename,
    b.batch_type,
    b.status,
    b.total_rows,
    b.processed_rows,
    b.failed_rows,
    b.skipped_rows,
    count(r.id) FILTER (WHERE r.status = 'pending'::text) AS pending_rows,
    count(r.id) AS actual_rows,
    b.created_at,
    b.updated_at
   FROM import_batches b
     LEFT JOIN import_rows r ON r.batch_id = b.id
  GROUP BY b.id
 HAVING b.status = 'completed'::text AND count(r.id) FILTER (WHERE r.status = 'pending'::text) > 0 OR b.status = 'completed'::text AND count(r.id) > 0 AND (COALESCE(b.processed_rows, 0) + COALESCE(b.failed_rows, 0) + COALESCE(b.skipped_rows, 0)) < count(r.id) OR b.status = 'uploading'::text AND b.created_at < (now() - '00:30:00'::interval);

create or replace view public.v_unmapped_industries as  SELECT 'company'::text AS source_type,
    companies.industry AS original_value,
    count(*) AS affected_count
   FROM companies
  WHERE companies.industry IS NOT NULL AND companies.industry <> ''::text AND companies.master_industry_id IS NULL AND NOT (EXISTS ( SELECT 1
           FROM industry_mappings im
          WHERE lower(im.original_value) = lower(companies.industry) AND im.source_type = 'company'::text))
  GROUP BY companies.industry
UNION ALL
 SELECT 'document'::text AS source_type,
    document_tags.tag_value AS original_value,
    count(*) AS affected_count
   FROM document_tags
  WHERE document_tags.tag_type = 'industry'::tag_type AND document_tags.tag_value IS NOT NULL AND document_tags.tag_value <> ''::text AND document_tags.master_industry_id IS NULL AND NOT (EXISTS ( SELECT 1
           FROM industry_mappings im
          WHERE lower(im.original_value) = lower(document_tags.tag_value) AND im.source_type = 'document'::text))
  GROUP BY document_tags.tag_value
  ORDER BY 3 DESC;

-- ============ TRIGGERS ============
drop trigger if exists admin_prompts_updated_at on public.admin_prompts;
CREATE TRIGGER admin_prompts_updated_at BEFORE UPDATE ON public.admin_prompts FOR EACH ROW EXECUTE FUNCTION update_admin_prompts_updated_at();
drop trigger if exists trg_normalize_company_industry on public.companies;
CREATE TRIGGER trg_normalize_company_industry BEFORE INSERT OR UPDATE OF industry ON public.companies FOR EACH ROW EXECUTE FUNCTION normalize_company_industry();
drop trigger if exists trg_normalize_country on public.companies;
CREATE TRIGGER trg_normalize_country BEFORE INSERT OR UPDATE OF country ON public.companies FOR EACH ROW EXECUTE FUNCTION trigger_normalize_country();
drop trigger if exists update_company_implementations_updated_at on public.company_implementations;
CREATE TRIGGER update_company_implementations_updated_at BEFORE UPDATE ON public.company_implementations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
drop trigger if exists update_company_news_updated_at on public.company_news;
CREATE TRIGGER update_company_news_updated_at BEFORE UPDATE ON public.company_news FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
drop trigger if exists trg_normalize_contact_country on public.contacts;
CREATE TRIGGER trg_normalize_contact_country BEFORE INSERT OR UPDATE OF country ON public.contacts FOR EACH ROW EXECUTE FUNCTION normalize_contact_country_trigger();
drop trigger if exists trg_refresh_cache_processes on public.dictionary_processes;
CREATE TRIGGER trg_refresh_cache_processes AFTER INSERT OR DELETE OR UPDATE ON public.dictionary_processes FOR EACH STATEMENT EXECUTE FUNCTION trigger_refresh_patterns_cache();
drop trigger if exists trigger_dictionary_processes_updated on public.dictionary_processes;
CREATE TRIGGER trigger_dictionary_processes_updated BEFORE UPDATE ON public.dictionary_processes FOR EACH ROW EXECUTE FUNCTION update_dictionary_timestamp();
drop trigger if exists trg_refresh_cache_products on public.dictionary_products;
CREATE TRIGGER trg_refresh_cache_products AFTER INSERT OR DELETE OR UPDATE ON public.dictionary_products FOR EACH STATEMENT EXECUTE FUNCTION trigger_refresh_patterns_cache();
drop trigger if exists trigger_dictionary_products_updated on public.dictionary_products;
CREATE TRIGGER trigger_dictionary_products_updated BEFORE UPDATE ON public.dictionary_products FOR EACH ROW EXECUTE FUNCTION update_dictionary_timestamp();
drop trigger if exists trg_normalize_document_industry on public.document_tags;
CREATE TRIGGER trg_normalize_document_industry BEFORE INSERT OR UPDATE ON public.document_tags FOR EACH ROW WHEN ((new.tag_type = 'industry'::tag_type)) EXECUTE FUNCTION normalize_document_tag_industry();
drop trigger if exists trigger_update_icebreaker_templates_updated_at on public.icebreaker_templates;
CREATE TRIGGER trigger_update_icebreaker_templates_updated_at BEFORE UPDATE ON public.icebreaker_templates FOR EACH ROW EXECUTE FUNCTION update_icebreaker_templates_updated_at();
drop trigger if exists trg_industry_mapping_propagate on public.industry_mappings;
CREATE TRIGGER trg_industry_mapping_propagate AFTER INSERT OR DELETE OR UPDATE ON public.industry_mappings FOR EACH ROW EXECUTE FUNCTION on_industry_mapping_change();
drop trigger if exists validate_pending_signals_trigger on public.pending_signals;
CREATE TRIGGER validate_pending_signals_trigger BEFORE INSERT OR UPDATE ON public.pending_signals FOR EACH ROW EXECUTE FUNCTION check_pending_signals_integrity();
drop trigger if exists update_success_cases_updated_at on public.success_cases;
CREATE TRIGGER update_success_cases_updated_at BEFORE UPDATE ON public.success_cases FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============ RLS ENABLE ============
alter table public.admin_audit_log enable row level security;
alter table public.admin_prompts enable row level security;
alter table public.apollo_api_calls enable row level security;
alter table public.apollo_contacts_cache enable row level security;
alter table public.apollo_search_queries enable row level security;
alter table public.apollo_search_results enable row level security;
alter table public.apollo_title_catalog enable row level security;
alter table public.bookmark_summaries enable row level security;
alter table public.bookmarks enable row level security;
alter table public.companies enable row level security;
alter table public.company_implementations enable row level security;
alter table public.company_news enable row level security;
alter table public.company_public_docs enable row level security;
alter table public.contacts enable row level security;
alter table public.cron_locks enable row level security;
alter table public.debug_events enable row level security;
alter table public.dictionary_jobs enable row level security;
alter table public.dictionary_processes enable row level security;
alter table public.dictionary_products enable row level security;
alter table public.dictionary_vendors enable row level security;
alter table public.digest_send_log enable row level security;
alter table public.document_tags enable row level security;
alter table public.icebreaker_templates enable row level security;
alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;
alter table public.industry_mappings enable row level security;
alter table public.ingestion_logs enable row level security;
alter table public.job_postings enable row level security;
alter table public.landing_stats enable row level security;
alter table public.master_industries enable row level security;
alter table public.pending_signals enable row level security;
alter table public.profiles enable row level security;
alter table public.radar_findings enable row level security;
alter table public.radar_research_runs enable row level security;
alter table public.resend_audiences enable row level security;
alter table public.signals enable row level security;
alter table public.success_cases enable row level security;
alter table public.system_health_logs enable row level security;
alter table public.user_company_contacts enable row level security;
alter table public.user_company_signals enable row level security;
alter table public.user_company_strategies enable row level security;
alter table public.user_digest_sent_items enable row level security;
alter table public.user_documents enable row level security;
alter table public.user_icebreakers enable row level security;
alter table public.user_implementation_interactions enable row level security;
alter table public.user_news_interactions enable row level security;
alter table public.user_notification_preferences enable row level security;
alter table public.user_onboarding enable row level security;
alter table public.user_public_doc_interactions enable row level security;
alter table public.user_value_profiles enable row level security;
alter table v3.account_briefs enable row level security;
alter table v3.account_contacts enable row level security;
alter table v3.account_evidence_details enable row level security;
alter table v3.account_internal_snapshots enable row level security;
alter table v3.account_scorecards enable row level security;
alter table v3.ai_prompt_versions enable row level security;
alter table v3.ai_prompts enable row level security;
alter table v3.ai_usage_log enable row level security;
alter table v3.buyer_personas enable row level security;
alter table v3.campaign_account_digest enable row level security;
alter table v3.campaign_accounts enable row level security;
alter table v3.campaigns enable row level security;
alter table v3.chat_conversations enable row level security;
alter table v3.chat_messages enable row level security;
alter table v3.client_ai_executions enable row level security;
alter table v3.client_ai_stage_submissions enable row level security;
alter table v3.company_dup_candidates enable row level security;
alter table v3.company_dup_groups enable row level security;
alter table v3.company_merges enable row level security;
alter table v3.company_name_index enable row level security;
alter table v3.contact_enrichment_runs enable row level security;
alter table v3.conversation_memory enable row level security;
alter table v3.dictionary_job_titles enable row level security;
alter table v3.dictionary_term_suggestions enable row level security;
alter table v3.digest_log enable row level security;
alter table v3.followed_account_subscribers enable row level security;
alter table v3.followed_accounts enable row level security;
alter table v3.icebreakers enable row level security;
alter table v3.mcp_api_keys enable row level security;
alter table v3.mcp_document_drafts enable row level security;
alter table v3.mcp_document_upload_tokens enable row level security;
alter table v3.mcp_oauth_authorization_codes enable row level security;
alter table v3.mcp_oauth_clients enable row level security;
alter table v3.mcp_oauth_tokens enable row level security;
alter table v3.mcp_request_logs enable row level security;
alter table v3.mcp_usage_reservations enable row level security;
alter table v3.research_jobs enable row level security;
alter table v3.research_stage_runs enable row level security;
alter table v3.tech_radar_runs enable row level security;
alter table v3.workspace_document_tags enable row level security;
alter table v3.workspace_documents enable row level security;
alter table v3.workspace_invitations enable row level security;
alter table v3.workspace_members enable row level security;
alter table v3.workspace_value_profiles enable row level security;
alter table v3.workspaces enable row level security;

-- ============ POLICIES ============
drop policy if exists "Service role can insert audit logs" on public.admin_audit_log;
create policy "Service role can insert audit logs" on public.admin_audit_log as permissive for INSERT to public
  with check (true);

drop policy if exists "Superadmins can read audit logs" on public.admin_audit_log;
create policy "Superadmins can read audit logs" on public.admin_audit_log as permissive for SELECT to public
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))));

drop policy if exists "Admins can manage prompts" on public.admin_prompts;
create policy "Admins can manage prompts" on public.admin_prompts as permissive for ALL to public
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'superadmin'::text]))))))
  with check ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'superadmin'::text]))))));

drop policy if exists "Authenticated can insert apollo api calls" on public.apollo_api_calls;
create policy "Authenticated can insert apollo api calls" on public.apollo_api_calls as permissive for INSERT to authenticated
  with check (true);

drop policy if exists "Service role manages apollo api calls" on public.apollo_api_calls;
create policy "Service role manages apollo api calls" on public.apollo_api_calls as permissive for ALL to service_role
  using (true)
  with check (true);

drop policy if exists "Superadmins can read apollo api calls" on public.apollo_api_calls;
create policy "Superadmins can read apollo api calls" on public.apollo_api_calls as permissive for SELECT to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['superadmin'::text, 'admin'::text]))))));

drop policy if exists apollo_api_calls_write_service on public.apollo_api_calls;
create policy apollo_api_calls_write_service on public.apollo_api_calls as permissive for ALL to service_role
  using (true)
  with check (true);

drop policy if exists "Authenticated users can insert apollo cache" on public.apollo_contacts_cache;
create policy "Authenticated users can insert apollo cache" on public.apollo_contacts_cache as permissive for INSERT to authenticated
  with check (true);

drop policy if exists "Authenticated users can read apollo cache" on public.apollo_contacts_cache;
create policy "Authenticated users can read apollo cache" on public.apollo_contacts_cache as permissive for SELECT to authenticated
  using (true);

drop policy if exists "Authenticated users can update apollo cache" on public.apollo_contacts_cache;
create policy "Authenticated users can update apollo cache" on public.apollo_contacts_cache as permissive for UPDATE to authenticated
  using (true)
  with check (true);

drop policy if exists "Service role can delete apollo cache" on public.apollo_contacts_cache;
create policy "Service role can delete apollo cache" on public.apollo_contacts_cache as permissive for DELETE to service_role
  using (true);

drop policy if exists apollo_contacts_cache_read on public.apollo_contacts_cache;
create policy apollo_contacts_cache_read on public.apollo_contacts_cache as permissive for SELECT to authenticated
  using (true);

drop policy if exists apollo_contacts_cache_write_service on public.apollo_contacts_cache;
create policy apollo_contacts_cache_write_service on public.apollo_contacts_cache as permissive for ALL to service_role
  using (true)
  with check (true);

drop policy if exists apollo_search_queries_read on public.apollo_search_queries;
create policy apollo_search_queries_read on public.apollo_search_queries as permissive for SELECT to authenticated
  using (true);

drop policy if exists apollo_search_queries_select_all on public.apollo_search_queries;
create policy apollo_search_queries_select_all on public.apollo_search_queries as permissive for SELECT to public
  using ((auth.role() = 'authenticated'::text));

drop policy if exists apollo_search_queries_service_write on public.apollo_search_queries;
create policy apollo_search_queries_service_write on public.apollo_search_queries as permissive for ALL to public
  using ((auth.role() = 'service_role'::text));

drop policy if exists apollo_search_queries_write_service on public.apollo_search_queries;
create policy apollo_search_queries_write_service on public.apollo_search_queries as permissive for ALL to service_role
  using (true)
  with check (true);

drop policy if exists apollo_search_results_read on public.apollo_search_results;
create policy apollo_search_results_read on public.apollo_search_results as permissive for SELECT to authenticated
  using (true);

drop policy if exists apollo_search_results_select_all on public.apollo_search_results;
create policy apollo_search_results_select_all on public.apollo_search_results as permissive for SELECT to public
  using ((auth.role() = 'authenticated'::text));

drop policy if exists apollo_search_results_service_write on public.apollo_search_results;
create policy apollo_search_results_service_write on public.apollo_search_results as permissive for ALL to public
  using ((auth.role() = 'service_role'::text));

drop policy if exists apollo_search_results_write_service on public.apollo_search_results;
create policy apollo_search_results_write_service on public.apollo_search_results as permissive for ALL to service_role
  using (true)
  with check (true);

drop policy if exists apollo_title_catalog_read on public.apollo_title_catalog;
create policy apollo_title_catalog_read on public.apollo_title_catalog as permissive for SELECT to authenticated
  using (true);

drop policy if exists apollo_title_catalog_write on public.apollo_title_catalog;
create policy apollo_title_catalog_write on public.apollo_title_catalog as permissive for ALL to service_role
  using (true)
  with check (true);

drop policy if exists apollo_title_catalog_write_service on public.apollo_title_catalog;
create policy apollo_title_catalog_write_service on public.apollo_title_catalog as permissive for ALL to service_role
  using (true)
  with check (true);

drop policy if exists "Users can create summaries for their own bookmarks" on public.bookmark_summaries;
create policy "Users can create summaries for their own bookmarks" on public.bookmark_summaries as permissive for INSERT to public
  with check ((bookmark_id IN ( SELECT bookmarks.id
   FROM bookmarks
  WHERE (bookmarks.user_id = auth.uid()))));

drop policy if exists "Users can delete their own bookmark summaries" on public.bookmark_summaries;
create policy "Users can delete their own bookmark summaries" on public.bookmark_summaries as permissive for DELETE to public
  using ((bookmark_id IN ( SELECT bookmarks.id
   FROM bookmarks
  WHERE (bookmarks.user_id = auth.uid()))));

drop policy if exists "Users can update their own bookmark summaries" on public.bookmark_summaries;
create policy "Users can update their own bookmark summaries" on public.bookmark_summaries as permissive for UPDATE to public
  using ((bookmark_id IN ( SELECT bookmarks.id
   FROM bookmarks
  WHERE (bookmarks.user_id = auth.uid()))));

drop policy if exists "Users can view their own bookmark summaries" on public.bookmark_summaries;
create policy "Users can view their own bookmark summaries" on public.bookmark_summaries as permissive for SELECT to public
  using ((bookmark_id IN ( SELECT bookmarks.id
   FROM bookmarks
  WHERE (bookmarks.user_id = auth.uid()))));

drop policy if exists "Users can manage own bookmarks" on public.bookmarks;
create policy "Users can manage own bookmarks" on public.bookmarks as permissive for ALL to public
  using ((auth.uid() = user_id));

drop policy if exists "Everyone can view companies" on public.companies;
create policy "Everyone can view companies" on public.companies as permissive for SELECT to public
  using ((auth.role() = 'authenticated'::text));

drop policy if exists "Superadmins can manage companies" on public.companies;
create policy "Superadmins can manage companies" on public.companies as permissive for ALL to public
  using (is_superadmin());

drop policy if exists "Anyone can view implementations for bookmarked companies" on public.company_implementations;
create policy "Anyone can view implementations for bookmarked companies" on public.company_implementations as permissive for SELECT to public
  using ((EXISTS ( SELECT 1
   FROM bookmarks
  WHERE ((bookmarks.company_id = company_implementations.company_id) AND (bookmarks.user_id = auth.uid())))));

drop policy if exists "Authenticated users can insert implementations" on public.company_implementations;
create policy "Authenticated users can insert implementations" on public.company_implementations as permissive for INSERT to public
  with check ((auth.uid() IS NOT NULL));

drop policy if exists "Authenticated users can update implementations" on public.company_implementations;
create policy "Authenticated users can update implementations" on public.company_implementations as permissive for UPDATE to public
  using ((auth.uid() IS NOT NULL));

drop policy if exists "Superadmins can delete implementations" on public.company_implementations;
create policy "Superadmins can delete implementations" on public.company_implementations as permissive for DELETE to public
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))));

drop policy if exists "Authenticated users can insert news" on public.company_news;
create policy "Authenticated users can insert news" on public.company_news as permissive for INSERT to public
  with check ((auth.uid() IS NOT NULL));

drop policy if exists "Authenticated users can view all news" on public.company_news;
create policy "Authenticated users can view all news" on public.company_news as permissive for SELECT to public
  using ((auth.uid() IS NOT NULL));

drop policy if exists "Contributors and superadmins can update news" on public.company_news;
create policy "Contributors and superadmins can update news" on public.company_news as permissive for UPDATE to public
  using ((is_superadmin() OR ((sourced_by_workspace IS NOT NULL) AND (sourced_by_workspace = v3.user_workspace_id(auth.uid())))))
  with check ((is_superadmin() OR ((sourced_by_workspace IS NOT NULL) AND (sourced_by_workspace = v3.user_workspace_id(auth.uid())))));

drop policy if exists "Superadmins can delete news" on public.company_news;
create policy "Superadmins can delete news" on public.company_news as permissive for DELETE to public
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))));

drop policy if exists "Anyone can view public docs for bookmarked companies" on public.company_public_docs;
create policy "Anyone can view public docs for bookmarked companies" on public.company_public_docs as permissive for SELECT to public
  using (((EXISTS ( SELECT 1
   FROM bookmarks b
  WHERE ((b.company_id = company_public_docs.company_id) AND (b.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'superadmin'::text))))));

drop policy if exists "Authenticated users can insert public docs" on public.company_public_docs;
create policy "Authenticated users can insert public docs" on public.company_public_docs as permissive for INSERT to public
  with check ((auth.uid() IS NOT NULL));

drop policy if exists "Authenticated users can update public docs" on public.company_public_docs;
create policy "Authenticated users can update public docs" on public.company_public_docs as permissive for UPDATE to public
  using ((auth.uid() IS NOT NULL));

drop policy if exists "Superadmins can delete public docs" on public.company_public_docs;
create policy "Superadmins can delete public docs" on public.company_public_docs as permissive for DELETE to public
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'superadmin'::text)))));

drop policy if exists "Everyone can view contacts" on public.contacts;
create policy "Everyone can view contacts" on public.contacts as permissive for SELECT to public
  using ((auth.role() = 'authenticated'::text));

drop policy if exists "Superadmins can manage contacts" on public.contacts;
create policy "Superadmins can manage contacts" on public.contacts as permissive for ALL to public
  using (is_superadmin());

drop policy if exists "Allow insert for authenticated users" on public.debug_events;
create policy "Allow insert for authenticated users" on public.debug_events as permissive for INSERT to public
  with check ((auth.role() = 'authenticated'::text));

drop policy if exists "Allow read access to authenticated users" on public.debug_events;
create policy "Allow read access to authenticated users" on public.debug_events as permissive for SELECT to public
  using ((auth.role() = 'authenticated'::text));

drop policy if exists "Superadmins can insert dictionary jobs" on public.dictionary_jobs;
create policy "Superadmins can insert dictionary jobs" on public.dictionary_jobs as permissive for INSERT to authenticated
  with check ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))));

drop policy if exists "Superadmins can update dictionary jobs" on public.dictionary_jobs;
create policy "Superadmins can update dictionary jobs" on public.dictionary_jobs as permissive for UPDATE to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))));

drop policy if exists "Superadmins can view dictionary jobs" on public.dictionary_jobs;
create policy "Superadmins can view dictionary jobs" on public.dictionary_jobs as permissive for SELECT to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))));

drop policy if exists "Everyone can view processes" on public.dictionary_processes;
create policy "Everyone can view processes" on public.dictionary_processes as permissive for SELECT to public
  using ((auth.role() = 'authenticated'::text));

drop policy if exists "Superadmins can manage processes" on public.dictionary_processes;
create policy "Superadmins can manage processes" on public.dictionary_processes as permissive for ALL to public
  using (is_superadmin());

drop policy if exists "Everyone can view products" on public.dictionary_products;
create policy "Everyone can view products" on public.dictionary_products as permissive for SELECT to public
  using ((auth.role() = 'authenticated'::text));

drop policy if exists "Superadmins can manage products" on public.dictionary_products;
create policy "Superadmins can manage products" on public.dictionary_products as permissive for ALL to public
  using (is_superadmin());

drop policy if exists "Everyone can view vendors" on public.dictionary_vendors;
create policy "Everyone can view vendors" on public.dictionary_vendors as permissive for SELECT to public
  using ((auth.role() = 'authenticated'::text));

drop policy if exists "Superadmins can manage vendors" on public.dictionary_vendors;
create policy "Superadmins can manage vendors" on public.dictionary_vendors as permissive for ALL to public
  using (is_superadmin());

drop policy if exists "Service role can manage digest log" on public.digest_send_log;
create policy "Service role can manage digest log" on public.digest_send_log as permissive for ALL to public
  using (true);

drop policy if exists "Users can view own digest log" on public.digest_send_log;
create policy "Users can view own digest log" on public.digest_send_log as permissive for SELECT to public
  using ((auth.uid() = user_id));

drop policy if exists "Users can manage their own document tags" on public.document_tags;
create policy "Users can manage their own document tags" on public.document_tags as permissive for ALL to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

drop policy if exists "Everyone can view active templates" on public.icebreaker_templates;
create policy "Everyone can view active templates" on public.icebreaker_templates as permissive for SELECT to authenticated
  using ((is_active = true));

drop policy if exists "Superadmins can manage templates" on public.icebreaker_templates;
create policy "Superadmins can manage templates" on public.icebreaker_templates as permissive for ALL to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))));

drop policy if exists "Superadmins can view all batches" on public.import_batches;
create policy "Superadmins can view all batches" on public.import_batches as permissive for SELECT to public
  using (is_superadmin());

drop policy if exists "Users can insert their own batches" on public.import_batches;
create policy "Users can insert their own batches" on public.import_batches as permissive for INSERT to public
  with check ((auth.uid() = user_id));

drop policy if exists "Users can update their own batches" on public.import_batches;
create policy "Users can update their own batches" on public.import_batches as permissive for UPDATE to public
  using ((auth.uid() = user_id));

drop policy if exists "Users can view their own batches" on public.import_batches;
create policy "Users can view their own batches" on public.import_batches as permissive for SELECT to public
  using ((auth.uid() = user_id));

drop policy if exists "Superadmins can view all rows" on public.import_rows;
create policy "Superadmins can view all rows" on public.import_rows as permissive for SELECT to public
  using (is_superadmin());

drop policy if exists "Users can insert rows to their batches" on public.import_rows;
create policy "Users can insert rows to their batches" on public.import_rows as permissive for INSERT to public
  with check ((EXISTS ( SELECT 1
   FROM import_batches
  WHERE ((import_batches.id = import_rows.batch_id) AND (import_batches.user_id = auth.uid())))));

drop policy if exists "Users can insert their own rows" on public.import_rows;
create policy "Users can insert their own rows" on public.import_rows as permissive for INSERT to public
  with check ((EXISTS ( SELECT 1
   FROM import_batches
  WHERE ((import_batches.id = import_rows.batch_id) AND (import_batches.user_id = auth.uid())))));

drop policy if exists "Users can view rows of their batches" on public.import_rows;
create policy "Users can view rows of their batches" on public.import_rows as permissive for SELECT to public
  using ((EXISTS ( SELECT 1
   FROM import_batches
  WHERE ((import_batches.id = import_rows.batch_id) AND (import_batches.user_id = auth.uid())))));

drop policy if exists "Users can view their own rows" on public.import_rows;
create policy "Users can view their own rows" on public.import_rows as permissive for SELECT to public
  using ((EXISTS ( SELECT 1
   FROM import_batches
  WHERE ((import_batches.id = import_rows.batch_id) AND (import_batches.user_id = auth.uid())))));

drop policy if exists industry_mappings_admin on public.industry_mappings;
create policy industry_mappings_admin on public.industry_mappings as permissive for ALL to public
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))));

drop policy if exists industry_mappings_select on public.industry_mappings;
create policy industry_mappings_select on public.industry_mappings as permissive for SELECT to public
  using (true);

drop policy if exists "Superadmins can insert logs" on public.ingestion_logs;
create policy "Superadmins can insert logs" on public.ingestion_logs as permissive for INSERT to public
  with check (is_superadmin());

drop policy if exists "Superadmins can view logs" on public.ingestion_logs;
create policy "Superadmins can view logs" on public.ingestion_logs as permissive for SELECT to public
  using (is_superadmin());

drop policy if exists landing_stats_public_read on public.landing_stats;
create policy landing_stats_public_read on public.landing_stats as permissive for SELECT to anon, authenticated
  using (true);

drop policy if exists master_industries_admin on public.master_industries;
create policy master_industries_admin on public.master_industries as permissive for ALL to public
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'superadmin'::text)))));

drop policy if exists master_industries_select on public.master_industries;
create policy master_industries_select on public.master_industries as permissive for SELECT to public
  using (true);

drop policy if exists "Superadmins can view all profiles" on public.profiles;
create policy "Superadmins can view all profiles" on public.profiles as permissive for SELECT to public
  using (is_superadmin());

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles as permissive for INSERT to public
  with check ((auth.uid() = id));

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles as permissive for UPDATE to public
  using ((auth.uid() = id));

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile" on public.profiles as permissive for SELECT to public
  using ((auth.uid() = id));

drop policy if exists "Service role full access radar_findings" on public.radar_findings;
create policy "Service role full access radar_findings" on public.radar_findings as permissive for ALL to service_role
  using (true);

drop policy if exists "Service role full access radar_research_runs" on public.radar_research_runs;
create policy "Service role full access radar_research_runs" on public.radar_research_runs as permissive for ALL to service_role
  using (true);

drop policy if exists "Users can view their own resend audience" on public.resend_audiences;
create policy "Users can view their own resend audience" on public.resend_audiences as permissive for SELECT to public
  using ((user_id = auth.uid()));

drop policy if exists "Everyone can view signals" on public.signals;
create policy "Everyone can view signals" on public.signals as permissive for SELECT to public
  using ((auth.role() = 'authenticated'::text));

drop policy if exists "Superadmins can manage signals" on public.signals;
create policy "Superadmins can manage signals" on public.signals as permissive for ALL to public
  using (is_superadmin());

drop policy if exists "Users can delete their own cases" on public.success_cases;
create policy "Users can delete their own cases" on public.success_cases as permissive for DELETE to public
  using ((auth.uid() = user_id));

drop policy if exists "Users can insert their own cases" on public.success_cases;
create policy "Users can insert their own cases" on public.success_cases as permissive for INSERT to public
  with check ((auth.uid() = user_id));

drop policy if exists "Users can update their own cases" on public.success_cases;
create policy "Users can update their own cases" on public.success_cases as permissive for UPDATE to public
  using ((auth.uid() = user_id));

drop policy if exists "Users can view their own cases" on public.success_cases;
create policy "Users can view their own cases" on public.success_cases as permissive for SELECT to public
  using ((auth.uid() = user_id));

drop policy if exists "Admins can view health logs" on public.system_health_logs;
create policy "Admins can view health logs" on public.system_health_logs as permissive for SELECT to public
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));

drop policy if exists "Service can insert health logs" on public.system_health_logs;
create policy "Service can insert health logs" on public.system_health_logs as permissive for INSERT to public
  with check (true);

drop policy if exists "Users can manage their own contacts" on public.user_company_contacts;
create policy "Users can manage their own contacts" on public.user_company_contacts as permissive for ALL to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

drop policy if exists "Users can manage their own signals" on public.user_company_signals;
create policy "Users can manage their own signals" on public.user_company_signals as permissive for ALL to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

drop policy if exists "Users can manage their own strategies" on public.user_company_strategies;
create policy "Users can manage their own strategies" on public.user_company_strategies as permissive for ALL to public
  using ((auth.uid() = user_id));

drop policy if exists "Service role can manage sent items" on public.user_digest_sent_items;
create policy "Service role can manage sent items" on public.user_digest_sent_items as permissive for ALL to public
  using (true);

drop policy if exists "Users can view own sent items" on public.user_digest_sent_items;
create policy "Users can view own sent items" on public.user_digest_sent_items as permissive for SELECT to public
  using ((auth.uid() = user_id));

drop policy if exists "Users can manage their own documents" on public.user_documents;
create policy "Users can manage their own documents" on public.user_documents as permissive for ALL to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

drop policy if exists "Users can manage their own icebreakers" on public.user_icebreakers;
create policy "Users can manage their own icebreakers" on public.user_icebreakers as permissive for ALL to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

drop policy if exists "Service role can manage all implementation interactions" on public.user_implementation_interactions;
create policy "Service role can manage all implementation interactions" on public.user_implementation_interactions as permissive for ALL to public
  using (((auth.jwt() ->> 'role'::text) = 'service_role'::text));

drop policy if exists "Users can insert their own implementation interactions" on public.user_implementation_interactions;
create policy "Users can insert their own implementation interactions" on public.user_implementation_interactions as permissive for INSERT to public
  with check ((auth.uid() = user_id));

drop policy if exists "Users can update their own implementation interactions" on public.user_implementation_interactions;
create policy "Users can update their own implementation interactions" on public.user_implementation_interactions as permissive for UPDATE to public
  using ((auth.uid() = user_id));

drop policy if exists "Users can view their own implementation interactions" on public.user_implementation_interactions;
create policy "Users can view their own implementation interactions" on public.user_implementation_interactions as permissive for SELECT to public
  using ((auth.uid() = user_id));

drop policy if exists "Service role can manage all news interactions" on public.user_news_interactions;
create policy "Service role can manage all news interactions" on public.user_news_interactions as permissive for ALL to public
  using (((auth.jwt() ->> 'role'::text) = 'service_role'::text));

drop policy if exists "Users can insert their own news interactions" on public.user_news_interactions;
create policy "Users can insert their own news interactions" on public.user_news_interactions as permissive for INSERT to public
  with check ((auth.uid() = user_id));

drop policy if exists "Users can update their own news interactions" on public.user_news_interactions;
create policy "Users can update their own news interactions" on public.user_news_interactions as permissive for UPDATE to public
  using ((auth.uid() = user_id));

drop policy if exists "Users can view their own news interactions" on public.user_news_interactions;
create policy "Users can view their own news interactions" on public.user_news_interactions as permissive for SELECT to public
  using ((auth.uid() = user_id));

drop policy if exists "Users can insert own preferences" on public.user_notification_preferences;
create policy "Users can insert own preferences" on public.user_notification_preferences as permissive for INSERT to public
  with check ((auth.uid() = user_id));

drop policy if exists "Users can update own preferences" on public.user_notification_preferences;
create policy "Users can update own preferences" on public.user_notification_preferences as permissive for UPDATE to public
  using ((auth.uid() = user_id));

drop policy if exists "Users can view own preferences" on public.user_notification_preferences;
create policy "Users can view own preferences" on public.user_notification_preferences as permissive for SELECT to public
  using ((auth.uid() = user_id));

drop policy if exists "Users can insert own onboarding" on public.user_onboarding;
create policy "Users can insert own onboarding" on public.user_onboarding as permissive for INSERT to public
  with check ((auth.uid() = user_id));

drop policy if exists "Users can update own onboarding" on public.user_onboarding;
create policy "Users can update own onboarding" on public.user_onboarding as permissive for UPDATE to public
  using ((auth.uid() = user_id));

drop policy if exists "Users can view own onboarding" on public.user_onboarding;
create policy "Users can view own onboarding" on public.user_onboarding as permissive for SELECT to public
  using ((auth.uid() = user_id));

drop policy if exists "Service role can manage all public doc interactions" on public.user_public_doc_interactions;
create policy "Service role can manage all public doc interactions" on public.user_public_doc_interactions as permissive for ALL to public
  using (((auth.jwt() ->> 'role'::text) = 'service_role'::text));

drop policy if exists "Users can insert their own public doc interactions" on public.user_public_doc_interactions;
create policy "Users can insert their own public doc interactions" on public.user_public_doc_interactions as permissive for INSERT to public
  with check ((auth.uid() = user_id));

drop policy if exists "Users can update their own public doc interactions" on public.user_public_doc_interactions;
create policy "Users can update their own public doc interactions" on public.user_public_doc_interactions as permissive for UPDATE to public
  using ((auth.uid() = user_id));

drop policy if exists "Users can view their own public doc interactions" on public.user_public_doc_interactions;
create policy "Users can view their own public doc interactions" on public.user_public_doc_interactions as permissive for SELECT to public
  using ((auth.uid() = user_id));

drop policy if exists "Users can manage their own value profile" on public.user_value_profiles;
create policy "Users can manage their own value profile" on public.user_value_profiles as permissive for ALL to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

drop policy if exists "Service role full access account_briefs" on v3.account_briefs;
create policy "Service role full access account_briefs" on v3.account_briefs as permissive for ALL to service_role
  using (true)
  with check (true);

drop policy if exists "Workspace access account_briefs" on v3.account_briefs;
create policy "Workspace access account_briefs" on v3.account_briefs as permissive for ALL to authenticated
  using ((workspace_id = v3.user_workspace_id(auth.uid())))
  with check ((workspace_id = v3.user_workspace_id(auth.uid())));

drop policy if exists "Service role full access account_internal_snapshots" on v3.account_internal_snapshots;
create policy "Service role full access account_internal_snapshots" on v3.account_internal_snapshots as permissive for ALL to service_role
  using (true)
  with check (true);

drop policy if exists "Workspace access account_internal_snapshots" on v3.account_internal_snapshots;
create policy "Workspace access account_internal_snapshots" on v3.account_internal_snapshots as permissive for ALL to authenticated
  using ((workspace_id = v3.user_workspace_id(auth.uid())))
  with check ((workspace_id = v3.user_workspace_id(auth.uid())));

drop policy if exists "Service role full access account_scorecards" on v3.account_scorecards;
create policy "Service role full access account_scorecards" on v3.account_scorecards as permissive for ALL to service_role
  using (true);

drop policy if exists "Users can access account_scorecards" on v3.account_scorecards;
create policy "Users can access account_scorecards" on v3.account_scorecards as permissive for ALL to public
  using ((workspace_id = v3.user_workspace_id(auth.uid())));

drop policy if exists "Service role full access ai_prompt_versions" on v3.ai_prompt_versions;
create policy "Service role full access ai_prompt_versions" on v3.ai_prompt_versions as permissive for ALL to service_role
  using (true);

drop policy if exists "Service role full access ai_prompts" on v3.ai_prompts;
create policy "Service role full access ai_prompts" on v3.ai_prompts as permissive for ALL to service_role
  using (true);

drop policy if exists "Service role full access ai_usage_log" on v3.ai_usage_log;
create policy "Service role full access ai_usage_log" on v3.ai_usage_log as permissive for ALL to service_role
  using (true);

drop policy if exists "Service role full access buyer personas" on v3.buyer_personas;
create policy "Service role full access buyer personas" on v3.buyer_personas as permissive for ALL to service_role
  using (true)
  with check (true);

drop policy if exists "Users can access buyer personas" on v3.buyer_personas;
create policy "Users can access buyer personas" on v3.buyer_personas as permissive for ALL to public
  using ((workspace_id = v3.user_workspace_id(auth.uid())));

drop policy if exists "Service role full access digest" on v3.campaign_account_digest;
create policy "Service role full access digest" on v3.campaign_account_digest as permissive for ALL to service_role
  using (true)
  with check (true);

drop policy if exists "Users can access digest" on v3.campaign_account_digest;
create policy "Users can access digest" on v3.campaign_account_digest as permissive for ALL to public
  using ((campaign_account_id IN ( SELECT ca.id
   FROM (v3.campaign_accounts ca
     JOIN v3.campaigns c ON ((ca.campaign_id = c.id)))
  WHERE (c.workspace_id = v3.user_workspace_id(auth.uid())))));

drop policy if exists "Service role full access campaign accounts" on v3.campaign_accounts;
create policy "Service role full access campaign accounts" on v3.campaign_accounts as permissive for ALL to service_role
  using (true)
  with check (true);

drop policy if exists "Users can access campaign accounts" on v3.campaign_accounts;
create policy "Users can access campaign accounts" on v3.campaign_accounts as permissive for ALL to public
  using ((campaign_id IN ( SELECT campaigns.id
   FROM v3.campaigns
  WHERE (campaigns.workspace_id = v3.user_workspace_id(auth.uid())))));

drop policy if exists "Service role full access campaigns" on v3.campaigns;
create policy "Service role full access campaigns" on v3.campaigns as permissive for ALL to service_role
  using (true)
  with check (true);

drop policy if exists "Users can access campaigns" on v3.campaigns;
create policy "Users can access campaigns" on v3.campaigns as permissive for ALL to public
  using ((workspace_id = v3.user_workspace_id(auth.uid())));

drop policy if exists "Service role full access chat_conversations" on v3.chat_conversations;
create policy "Service role full access chat_conversations" on v3.chat_conversations as permissive for ALL to service_role
  using (true);

drop policy if exists "Users can access chat_conversations" on v3.chat_conversations;
create policy "Users can access chat_conversations" on v3.chat_conversations as permissive for ALL to public
  using (((user_id = auth.uid()) AND (workspace_id = v3.user_workspace_id(auth.uid()))));

drop policy if exists "Service role full access chat_messages" on v3.chat_messages;
create policy "Service role full access chat_messages" on v3.chat_messages as permissive for ALL to service_role
  using (true);

drop policy if exists "Users can access chat_messages" on v3.chat_messages;
create policy "Users can access chat_messages" on v3.chat_messages as permissive for ALL to public
  using ((conversation_id IN ( SELECT chat_conversations.id
   FROM v3.chat_conversations
  WHERE ((chat_conversations.user_id = auth.uid()) AND (chat_conversations.workspace_id = v3.user_workspace_id(auth.uid()))))));

drop policy if exists company_dup_groups_service_only on v3.company_dup_groups;
create policy company_dup_groups_service_only on v3.company_dup_groups as permissive for ALL to service_role
  using (true)
  with check (true);

drop policy if exists company_name_index_service_only on v3.company_name_index;
create policy company_name_index_service_only on v3.company_name_index as permissive for ALL to service_role
  using (true)
  with check (true);

drop policy if exists "Service role full access conversation_memory" on v3.conversation_memory;
create policy "Service role full access conversation_memory" on v3.conversation_memory as permissive for ALL to service_role
  using (true)
  with check (true);

drop policy if exists "Workspace access conversation_memory" on v3.conversation_memory;
create policy "Workspace access conversation_memory" on v3.conversation_memory as permissive for ALL to authenticated
  using ((workspace_id = v3.user_workspace_id(auth.uid())))
  with check ((workspace_id = v3.user_workspace_id(auth.uid())));

drop policy if exists "Anyone can read dictionary" on v3.dictionary_job_titles;
create policy "Anyone can read dictionary" on v3.dictionary_job_titles as permissive for SELECT to public
  using (true);

drop policy if exists "Service role full access dictionary" on v3.dictionary_job_titles;
create policy "Service role full access dictionary" on v3.dictionary_job_titles as permissive for ALL to service_role
  using (true)
  with check (true);

drop policy if exists "Service role full access dictionary_term_suggestions" on v3.dictionary_term_suggestions;
create policy "Service role full access dictionary_term_suggestions" on v3.dictionary_term_suggestions as permissive for ALL to service_role
  using (true);

drop policy if exists "Service role full access digest_log" on v3.digest_log;
create policy "Service role full access digest_log" on v3.digest_log as permissive for ALL to service_role
  using (true);

drop policy if exists "Users can access digest_log" on v3.digest_log;
create policy "Users can access digest_log" on v3.digest_log as permissive for ALL to public
  using ((workspace_id = v3.user_workspace_id(auth.uid())));

drop policy if exists "Service role full access followed_account_subscribers" on v3.followed_account_subscribers;
create policy "Service role full access followed_account_subscribers" on v3.followed_account_subscribers as permissive for ALL to service_role
  using (true);

drop policy if exists "Users can access followed_account_subscribers" on v3.followed_account_subscribers;
create policy "Users can access followed_account_subscribers" on v3.followed_account_subscribers as permissive for ALL to public
  using ((workspace_id = v3.user_workspace_id(auth.uid())));

drop policy if exists "Service role full access followed_accounts" on v3.followed_accounts;
create policy "Service role full access followed_accounts" on v3.followed_accounts as permissive for ALL to service_role
  using (true);

drop policy if exists "Users can access followed_accounts" on v3.followed_accounts;
create policy "Users can access followed_accounts" on v3.followed_accounts as permissive for ALL to public
  using ((workspace_id = v3.user_workspace_id(auth.uid())));

drop policy if exists "Service role full access icebreakers" on v3.icebreakers;
create policy "Service role full access icebreakers" on v3.icebreakers as permissive for ALL to service_role
  using (true);

drop policy if exists "Users can access icebreakers" on v3.icebreakers;
create policy "Users can access icebreakers" on v3.icebreakers as permissive for ALL to public
  using ((workspace_id = v3.user_workspace_id(auth.uid())));

drop policy if exists "Admins can manage api keys" on v3.mcp_api_keys;
create policy "Admins can manage api keys" on v3.mcp_api_keys as permissive for ALL to public
  using ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM v3.workspace_members
  WHERE ((workspace_members.user_id = auth.uid()) AND (workspace_members.status = 'active'::text) AND (workspace_members.role = 'admin'::text)))));

drop policy if exists "Service role full access api keys" on v3.mcp_api_keys;
create policy "Service role full access api keys" on v3.mcp_api_keys as permissive for ALL to service_role
  using (true)
  with check (true);

drop policy if exists "Members can create MCP document drafts" on v3.mcp_document_drafts;
create policy "Members can create MCP document drafts" on v3.mcp_document_drafts as permissive for INSERT to authenticated
  with check (((created_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM v3.workspace_members wm
  WHERE ((wm.workspace_id = mcp_document_drafts.workspace_id) AND (wm.user_id = auth.uid()) AND (wm.status = 'active'::text))))));

drop policy if exists "Members can update own MCP document drafts" on v3.mcp_document_drafts;
create policy "Members can update own MCP document drafts" on v3.mcp_document_drafts as permissive for UPDATE to authenticated
  using (((created_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM v3.workspace_members wm
  WHERE ((wm.workspace_id = mcp_document_drafts.workspace_id) AND (wm.user_id = auth.uid()) AND (wm.status = 'active'::text))))))
  with check ((created_by = auth.uid()));

drop policy if exists "Members can view MCP document drafts" on v3.mcp_document_drafts;
create policy "Members can view MCP document drafts" on v3.mcp_document_drafts as permissive for SELECT to authenticated
  using ((EXISTS ( SELECT 1
   FROM v3.workspace_members wm
  WHERE ((wm.workspace_id = mcp_document_drafts.workspace_id) AND (wm.user_id = auth.uid()) AND (wm.status = 'active'::text)))));

drop policy if exists "Admins can view logs" on v3.mcp_request_logs;
create policy "Admins can view logs" on v3.mcp_request_logs as permissive for SELECT to public
  using ((api_key_id IN ( SELECT mcp_api_keys.id
   FROM v3.mcp_api_keys
  WHERE (mcp_api_keys.workspace_id IN ( SELECT workspace_members.workspace_id
           FROM v3.workspace_members
          WHERE ((workspace_members.user_id = auth.uid()) AND (workspace_members.status = 'active'::text) AND (workspace_members.role = 'admin'::text)))))));

drop policy if exists "Service role full access logs" on v3.mcp_request_logs;
create policy "Service role full access logs" on v3.mcp_request_logs as permissive for ALL to service_role
  using (true)
  with check (true);

drop policy if exists "Service role full access research_jobs" on v3.research_jobs;
create policy "Service role full access research_jobs" on v3.research_jobs as permissive for ALL to service_role
  using (true);

drop policy if exists "Users can access research_jobs" on v3.research_jobs;
create policy "Users can access research_jobs" on v3.research_jobs as permissive for ALL to public
  using ((workspace_id = v3.user_workspace_id(auth.uid())));

drop policy if exists "Service role full access research_stage_runs" on v3.research_stage_runs;
create policy "Service role full access research_stage_runs" on v3.research_stage_runs as permissive for ALL to service_role
  using (true)
  with check (true);

drop policy if exists "Workspace access research_stage_runs" on v3.research_stage_runs;
create policy "Workspace access research_stage_runs" on v3.research_stage_runs as permissive for ALL to authenticated
  using ((workspace_id = v3.user_workspace_id(auth.uid())))
  with check ((workspace_id = v3.user_workspace_id(auth.uid())));

drop policy if exists "Service role full access document tags" on v3.workspace_document_tags;
create policy "Service role full access document tags" on v3.workspace_document_tags as permissive for ALL to service_role
  using (true)
  with check (true);

drop policy if exists "Users can access document tags" on v3.workspace_document_tags;
create policy "Users can access document tags" on v3.workspace_document_tags as permissive for ALL to public
  using ((workspace_id = v3.user_workspace_id(auth.uid())));

drop policy if exists "Active members can insert documents" on v3.workspace_documents;
create policy "Active members can insert documents" on v3.workspace_documents as permissive for INSERT to authenticated
  with check (((uploaded_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM v3.workspace_members wm
  WHERE ((wm.workspace_id = workspace_documents.workspace_id) AND (wm.user_id = auth.uid()) AND (wm.status = 'active'::text))))));

drop policy if exists "Active members can update documents" on v3.workspace_documents;
create policy "Active members can update documents" on v3.workspace_documents as permissive for UPDATE to authenticated
  using ((EXISTS ( SELECT 1
   FROM v3.workspace_members wm
  WHERE ((wm.workspace_id = workspace_documents.workspace_id) AND (wm.user_id = auth.uid()) AND (wm.status = 'active'::text)))))
  with check ((EXISTS ( SELECT 1
   FROM v3.workspace_members wm
  WHERE ((wm.workspace_id = workspace_documents.workspace_id) AND (wm.user_id = auth.uid()) AND (wm.status = 'active'::text)))));

drop policy if exists "Service role full access documents" on v3.workspace_documents;
create policy "Service role full access documents" on v3.workspace_documents as permissive for ALL to service_role
  using (true)
  with check (true);

drop policy if exists "Users can access documents" on v3.workspace_documents;
create policy "Users can access documents" on v3.workspace_documents as permissive for ALL to public
  using ((workspace_id = v3.user_workspace_id(auth.uid())));

drop policy if exists "Admins can manage members" on v3.workspace_members;
create policy "Admins can manage members" on v3.workspace_members as permissive for ALL to public
  using ((workspace_id IN ( SELECT workspace_members_1.workspace_id
   FROM v3.workspace_members workspace_members_1
  WHERE ((workspace_members_1.user_id = auth.uid()) AND (workspace_members_1.status = 'active'::text) AND (workspace_members_1.role = 'admin'::text)))));

drop policy if exists "Service role full access members" on v3.workspace_members;
create policy "Service role full access members" on v3.workspace_members as permissive for ALL to service_role
  using (true)
  with check (true);

drop policy if exists "Users can insert own membership" on v3.workspace_members;
create policy "Users can insert own membership" on v3.workspace_members as permissive for INSERT to public
  with check ((user_id = auth.uid()));

drop policy if exists "Users can view members" on v3.workspace_members;
create policy "Users can view members" on v3.workspace_members as permissive for SELECT to public
  using (((workspace_id IN ( SELECT workspace_members_1.workspace_id
   FROM v3.workspace_members workspace_members_1
  WHERE (workspace_members_1.user_id = auth.uid()))) OR (user_id = auth.uid())));

drop policy if exists "Service role full access value profiles" on v3.workspace_value_profiles;
create policy "Service role full access value profiles" on v3.workspace_value_profiles as permissive for ALL to service_role
  using (true)
  with check (true);

drop policy if exists "Users can access value profiles" on v3.workspace_value_profiles;
create policy "Users can access value profiles" on v3.workspace_value_profiles as permissive for ALL to public
  using ((workspace_id = v3.user_workspace_id(auth.uid())));

drop policy if exists "Service role full access workspaces" on v3.workspaces;
create policy "Service role full access workspaces" on v3.workspaces as permissive for ALL to service_role
  using (true)
  with check (true);

drop policy if exists "Users can create workspaces" on v3.workspaces;
create policy "Users can create workspaces" on v3.workspaces as permissive for INSERT to public
  with check ((created_by = auth.uid()));

drop policy if exists "Users can view their workspace" on v3.workspaces;
create policy "Users can view their workspace" on v3.workspaces as permissive for SELECT to public
  using (((id IN ( SELECT workspace_members.workspace_id
   FROM v3.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))) OR (created_by = auth.uid())));

-- ============ GRANTS ============
-- Espejo del bloque final de scripts/300_v3_schema_setup.sql. Para public, los
-- grants de base los administra Supabase por defecto (service_role/postgres con
-- acceso amplio; anon/authenticated gateados por las policies de arriba).
grant usage on schema v3 to anon, authenticated, service_role;
grant all on all tables in schema v3 to anon, authenticated, service_role;
grant all on all sequences in schema v3 to anon, authenticated, service_role;
grant execute on all functions in schema v3 to anon, authenticated, service_role;

-- ============================================================================
-- FIN DEL BASELINE
-- ============================================================================
