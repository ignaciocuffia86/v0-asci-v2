-- ═══════════════════════════════════════════════════════════════════════════
-- ASCI V3 - Seed de Job Titles por Proceso/Tecnologia
-- Script: 202_v3_seed_job_titles.sql
-- 
-- Pobla v3.dictionary_job_titles con job titles iniciales.
-- Los process_id y product_id se obtienen de las tablas existentes en v2.
--
-- Referencia: docs/BOT-BIGUA-LAT-ARCHITECTURE.md seccion 9 (Buyer Personas)
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════
-- JOB TITLES POR PROCESO (public.dictionary_processes)
-- ═══════════════════════════════════════════════════════════

-- ERP / Finance
INSERT INTO v3.dictionary_job_titles (process_id, job_title, seniority, is_inferred)
SELECT p.id, t.job_title, t.seniority, false
FROM public.dictionary_processes p
CROSS JOIN (VALUES 
  ('CIO', 'c_level'),
  ('CFO', 'c_level'),
  ('CTO', 'c_level'),
  ('VP Operations', 'vp'),
  ('VP Finance', 'vp'),
  ('Director of IT', 'director'),
  ('Director of Operations', 'director'),
  ('IT Manager', 'manager'),
  ('ERP Manager', 'manager')
) AS t(job_title, seniority)
WHERE p.name ILIKE '%erp%' OR p.name ILIKE '%finance%' OR p.name ILIKE '%operations%'
ON CONFLICT DO NOTHING;

-- Sales / CRM
INSERT INTO v3.dictionary_job_titles (process_id, job_title, seniority, is_inferred)
SELECT p.id, t.job_title, t.seniority, false
FROM public.dictionary_processes p
CROSS JOIN (VALUES 
  ('CRO', 'c_level'),
  ('CMO', 'c_level'),
  ('VP Sales', 'vp'),
  ('VP Revenue', 'vp'),
  ('VP Marketing', 'vp'),
  ('Sales Director', 'director'),
  ('Director of Revenue Operations', 'director'),
  ('RevOps Manager', 'manager'),
  ('Sales Operations Manager', 'manager'),
  ('CRM Manager', 'manager')
) AS t(job_title, seniority)
WHERE p.name ILIKE '%sales%' OR p.name ILIKE '%crm%' OR p.name ILIKE '%revenue%'
ON CONFLICT DO NOTHING;

-- Marketing
INSERT INTO v3.dictionary_job_titles (process_id, job_title, seniority, is_inferred)
SELECT p.id, t.job_title, t.seniority, false
FROM public.dictionary_processes p
CROSS JOIN (VALUES 
  ('CMO', 'c_level'),
  ('VP Marketing', 'vp'),
  ('VP Growth', 'vp'),
  ('Director of Marketing', 'director'),
  ('Director of Digital Marketing', 'director'),
  ('Head of Demand Generation', 'director'),
  ('Marketing Manager', 'manager'),
  ('Growth Marketing Manager', 'manager')
) AS t(job_title, seniority)
WHERE p.name ILIKE '%marketing%' OR p.name ILIKE '%demand%' OR p.name ILIKE '%growth%'
ON CONFLICT DO NOTHING;

-- Engineering / Development
INSERT INTO v3.dictionary_job_titles (process_id, job_title, seniority, is_inferred)
SELECT p.id, t.job_title, t.seniority, false
FROM public.dictionary_processes p
CROSS JOIN (VALUES 
  ('CTO', 'c_level'),
  ('VP Engineering', 'vp'),
  ('VP Technology', 'vp'),
  ('VP Product', 'vp'),
  ('Director of Engineering', 'director'),
  ('Head of Engineering', 'director'),
  ('Engineering Manager', 'manager'),
  ('Technical Lead', 'senior'),
  ('Staff Engineer', 'senior')
) AS t(job_title, seniority)
WHERE p.name ILIKE '%engineering%' OR p.name ILIKE '%development%' OR p.name ILIKE '%software%'
ON CONFLICT DO NOTHING;

-- Data & Analytics
INSERT INTO v3.dictionary_job_titles (process_id, job_title, seniority, is_inferred)
SELECT p.id, t.job_title, t.seniority, false
FROM public.dictionary_processes p
CROSS JOIN (VALUES 
  ('CDO', 'c_level'),
  ('Chief Data Officer', 'c_level'),
  ('VP Data', 'vp'),
  ('VP Analytics', 'vp'),
  ('Head of Data', 'director'),
  ('Director of Analytics', 'director'),
  ('Director of Business Intelligence', 'director'),
  ('Data Engineering Manager', 'manager'),
  ('Analytics Manager', 'manager')
) AS t(job_title, seniority)
WHERE p.name ILIKE '%data%' OR p.name ILIKE '%analytics%' OR p.name ILIKE '%intelligence%'
ON CONFLICT DO NOTHING;

-- Security
INSERT INTO v3.dictionary_job_titles (process_id, job_title, seniority, is_inferred)
SELECT p.id, t.job_title, t.seniority, false
FROM public.dictionary_processes p
CROSS JOIN (VALUES 
  ('CISO', 'c_level'),
  ('Chief Security Officer', 'c_level'),
  ('VP Security', 'vp'),
  ('VP Information Security', 'vp'),
  ('Director of Security', 'director'),
  ('Head of Security', 'director'),
  ('Security Manager', 'manager'),
  ('IT Security Manager', 'manager')
) AS t(job_title, seniority)
WHERE p.name ILIKE '%security%' OR p.name ILIKE '%cyber%' OR p.name ILIKE '%infosec%'
ON CONFLICT DO NOTHING;

-- HR / People
INSERT INTO v3.dictionary_job_titles (process_id, job_title, seniority, is_inferred)
SELECT p.id, t.job_title, t.seniority, false
FROM public.dictionary_processes p
CROSS JOIN (VALUES 
  ('CHRO', 'c_level'),
  ('Chief People Officer', 'c_level'),
  ('VP HR', 'vp'),
  ('VP People', 'vp'),
  ('VP Talent', 'vp'),
  ('Director of HR', 'director'),
  ('Head of People', 'director'),
  ('HR Manager', 'manager'),
  ('People Operations Manager', 'manager')
) AS t(job_title, seniority)
WHERE p.name ILIKE '%hr%' OR p.name ILIKE '%human%' OR p.name ILIKE '%people%' OR p.name ILIKE '%talent%'
ON CONFLICT DO NOTHING;

-- Supply Chain / Logistics
INSERT INTO v3.dictionary_job_titles (process_id, job_title, seniority, is_inferred)
SELECT p.id, t.job_title, t.seniority, false
FROM public.dictionary_processes p
CROSS JOIN (VALUES 
  ('COO', 'c_level'),
  ('Chief Supply Chain Officer', 'c_level'),
  ('VP Supply Chain', 'vp'),
  ('VP Logistics', 'vp'),
  ('VP Operations', 'vp'),
  ('Director of Supply Chain', 'director'),
  ('Director of Logistics', 'director'),
  ('Supply Chain Manager', 'manager'),
  ('Logistics Manager', 'manager')
) AS t(job_title, seniority)
WHERE p.name ILIKE '%supply%' OR p.name ILIKE '%logistics%' OR p.name ILIKE '%procurement%'
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════
-- JOB TITLES POR TECNOLOGIA (public.dictionary_products)
-- ═══════════════════════════════════════════════════════════

-- Cloud (AWS, Azure, GCP)
INSERT INTO v3.dictionary_job_titles (product_id, job_title, seniority, is_inferred)
SELECT p.id, t.job_title, t.seniority, false
FROM public.dictionary_products p
CROSS JOIN (VALUES 
  ('CTO', 'c_level'),
  ('VP Engineering', 'vp'),
  ('VP Infrastructure', 'vp'),
  ('Cloud Architect', 'senior'),
  ('Director of Infrastructure', 'director'),
  ('Head of DevOps', 'director'),
  ('DevOps Manager', 'manager'),
  ('Platform Engineering Manager', 'manager')
) AS t(job_title, seniority)
WHERE p.name ILIKE '%aws%' OR p.name ILIKE '%azure%' OR p.name ILIKE '%google cloud%' OR p.name ILIKE '%gcp%'
ON CONFLICT DO NOTHING;

-- Salesforce
INSERT INTO v3.dictionary_job_titles (product_id, job_title, seniority, is_inferred)
SELECT p.id, t.job_title, t.seniority, false
FROM public.dictionary_products p
CROSS JOIN (VALUES 
  ('CRO', 'c_level'),
  ('VP Sales', 'vp'),
  ('VP Revenue Operations', 'vp'),
  ('Director of Sales Operations', 'director'),
  ('Salesforce Administrator', 'individual_contributor'),
  ('RevOps Manager', 'manager'),
  ('CRM Manager', 'manager')
) AS t(job_title, seniority)
WHERE p.name ILIKE '%salesforce%'
ON CONFLICT DO NOTHING;

-- SAP
INSERT INTO v3.dictionary_job_titles (product_id, job_title, seniority, is_inferred)
SELECT p.id, t.job_title, t.seniority, false
FROM public.dictionary_products p
CROSS JOIN (VALUES 
  ('CIO', 'c_level'),
  ('CFO', 'c_level'),
  ('VP IT', 'vp'),
  ('VP Operations', 'vp'),
  ('SAP Program Director', 'director'),
  ('Director of ERP', 'director'),
  ('SAP Manager', 'manager'),
  ('SAP Basis Administrator', 'individual_contributor')
) AS t(job_title, seniority)
WHERE p.name ILIKE '%sap%'
ON CONFLICT DO NOTHING;

-- Microsoft (Office 365, Dynamics, etc)
INSERT INTO v3.dictionary_job_titles (product_id, job_title, seniority, is_inferred)
SELECT p.id, t.job_title, t.seniority, false
FROM public.dictionary_products p
CROSS JOIN (VALUES 
  ('CIO', 'c_level'),
  ('CTO', 'c_level'),
  ('VP IT', 'vp'),
  ('Director of IT', 'director'),
  ('IT Manager', 'manager'),
  ('Microsoft 365 Administrator', 'individual_contributor'),
  ('Systems Administrator', 'individual_contributor')
) AS t(job_title, seniority)
WHERE p.name ILIKE '%microsoft%' OR p.name ILIKE '%office 365%' OR p.name ILIKE '%dynamics%'
ON CONFLICT DO NOTHING;

-- HubSpot
INSERT INTO v3.dictionary_job_titles (product_id, job_title, seniority, is_inferred)
SELECT p.id, t.job_title, t.seniority, false
FROM public.dictionary_products p
CROSS JOIN (VALUES 
  ('CMO', 'c_level'),
  ('VP Marketing', 'vp'),
  ('VP Growth', 'vp'),
  ('Director of Marketing', 'director'),
  ('Director of Demand Generation', 'director'),
  ('Marketing Operations Manager', 'manager'),
  ('HubSpot Administrator', 'individual_contributor')
) AS t(job_title, seniority)
WHERE p.name ILIKE '%hubspot%'
ON CONFLICT DO NOTHING;

-- Workday
INSERT INTO v3.dictionary_job_titles (product_id, job_title, seniority, is_inferred)
SELECT p.id, t.job_title, t.seniority, false
FROM public.dictionary_products p
CROSS JOIN (VALUES 
  ('CHRO', 'c_level'),
  ('CFO', 'c_level'),
  ('VP HR', 'vp'),
  ('VP People', 'vp'),
  ('Director of HRIS', 'director'),
  ('Director of HR Technology', 'director'),
  ('Workday Administrator', 'individual_contributor'),
  ('HRIS Manager', 'manager')
) AS t(job_title, seniority)
WHERE p.name ILIKE '%workday%'
ON CONFLICT DO NOTHING;

-- ServiceNow
INSERT INTO v3.dictionary_job_titles (product_id, job_title, seniority, is_inferred)
SELECT p.id, t.job_title, t.seniority, false
FROM public.dictionary_products p
CROSS JOIN (VALUES 
  ('CIO', 'c_level'),
  ('VP IT', 'vp'),
  ('VP IT Service Management', 'vp'),
  ('Director of IT Operations', 'director'),
  ('Director of Service Delivery', 'director'),
  ('ServiceNow Administrator', 'individual_contributor'),
  ('IT Service Manager', 'manager')
) AS t(job_title, seniority)
WHERE p.name ILIKE '%servicenow%'
ON CONFLICT DO NOTHING;

-- Snowflake / Databricks (Data platforms)
INSERT INTO v3.dictionary_job_titles (product_id, job_title, seniority, is_inferred)
SELECT p.id, t.job_title, t.seniority, false
FROM public.dictionary_products p
CROSS JOIN (VALUES 
  ('CDO', 'c_level'),
  ('CTO', 'c_level'),
  ('VP Data', 'vp'),
  ('VP Analytics', 'vp'),
  ('Head of Data Engineering', 'director'),
  ('Director of Data Platform', 'director'),
  ('Data Engineering Manager', 'manager'),
  ('Data Architect', 'senior')
) AS t(job_title, seniority)
WHERE p.name ILIKE '%snowflake%' OR p.name ILIKE '%databricks%'
ON CONFLICT DO NOTHING;

-- Slack / Teams (Collaboration)
INSERT INTO v3.dictionary_job_titles (product_id, job_title, seniority, is_inferred)
SELECT p.id, t.job_title, t.seniority, false
FROM public.dictionary_products p
CROSS JOIN (VALUES 
  ('CIO', 'c_level'),
  ('VP IT', 'vp'),
  ('Director of IT', 'director'),
  ('Director of Workplace Technology', 'director'),
  ('IT Manager', 'manager'),
  ('Collaboration Tools Administrator', 'individual_contributor')
) AS t(job_title, seniority)
WHERE p.name ILIKE '%slack%' OR p.name ILIKE '%teams%'
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════
-- JOB TITLES GENERICOS (sin proceso/tecnologia especifica)
-- Estos se asignan a un proceso generico si existe
-- ═══════════════════════════════════════════════════════════

-- Si no matcheo nada, agregar job titles genericos de tecnologia
INSERT INTO v3.dictionary_job_titles (process_id, job_title, seniority, is_inferred)
SELECT p.id, t.job_title, t.seniority, false
FROM public.dictionary_processes p
CROSS JOIN (VALUES 
  ('CIO', 'c_level'),
  ('CTO', 'c_level'),
  ('VP Technology', 'vp'),
  ('VP IT', 'vp'),
  ('Director of IT', 'director'),
  ('IT Manager', 'manager')
) AS t(job_title, seniority)
WHERE p.name ILIKE '%technology%' OR p.name ILIKE '%information%'
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════
-- RESUMEN
-- ═══════════════════════════════════════════════════════════

DO $$
DECLARE
  total_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_count FROM v3.dictionary_job_titles;
  RAISE NOTICE 'Total job titles insertados: %', total_count;
END $$;
