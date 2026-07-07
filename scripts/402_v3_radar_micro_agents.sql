-- ============================================================================
-- 402_v3_radar_micro_agents.sql
-- Veracidad + foco de la investigación de cuentas (v3).
-- Migración ADITIVA. No toca datos ni estructuras de v2.
--
-- 1) Catálogo editable de micro-agentes de research (v3.radar_micro_agents),
--    mapeado al diccionario (productos/procesos) y con keywords para el
--    matching contra la propuesta de valor + tags del workspace.
-- 2) Columnas de trazabilidad en public.radar_findings para soportar
--    múltiples fuentes verificadas y convergencia.
-- ============================================================================

-- ─── 1) Catálogo de micro-agentes ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS v3.radar_micro_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,                 -- slug estable (erp, crm, cloud_hosting, …)
  label text NOT NULL,                      -- nombre visible
  description text,                         -- para qué sirve este agente
  radar_type text NOT NULL DEFAULT 'tech',  -- 'tech' | 'news'
  focus_prompt text NOT NULL,               -- instrucciones + queries sugeridas para el research
  dictionary_product_ids uuid[] NOT NULL DEFAULT '{}',
  dictionary_process_ids uuid[] NOT NULL DEFAULT '{}',
  keywords text[] NOT NULL DEFAULT '{}',    -- términos para matching de fit
  enabled boolean NOT NULL DEFAULT true,
  priority int NOT NULL DEFAULT 100,        -- orden/desempate (mayor = más prioritario)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_micro_agents_enabled
  ON v3.radar_micro_agents (enabled, priority DESC);

COMMENT ON TABLE v3.radar_micro_agents IS
  'Catálogo editable de micro-agentes de investigación de cuentas. Cada uno enfoca un área tecnológica/negocio y se selecciona dinámicamente según la propuesta de valor y los tags del workspace.';

-- ─── 2) Trazabilidad de fuentes en radar_findings ──────────────────────────
ALTER TABLE public.radar_findings
  ADD COLUMN IF NOT EXISTS micro_agent text,
  ADD COLUMN IF NOT EXISTS supporting_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS convergent_sources int NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.radar_findings.micro_agent IS
  'Key del micro-agente que generó el hallazgo (v3.radar_micro_agents.key). NULL para hallazgos legacy.';
COMMENT ON COLUMN public.radar_findings.supporting_sources IS
  'Array JSON de fuentes verificadas [{url,title,date}]. La fuente primaria también está en url/source_name/source_date.';
COMMENT ON COLUMN public.radar_findings.convergent_sources IS
  'Cantidad de fuentes distintas que confirman el hallazgo. >=2 implica evidencia convergente.';

CREATE INDEX IF NOT EXISTS idx_radar_findings_company_micro_agent
  ON public.radar_findings (company_id, micro_agent);

-- ─── 3) Seed inicial de micro-agentes ──────────────────────────────────────
-- Basado en el orquestador de 17 áreas de v2 (script 161), adaptado a v3 y
-- exigiendo búsqueda web con citas reales. El mapeo al diccionario se completa
-- desde el panel admin (dictionary_*_ids arrancan vacíos).
INSERT INTO v3.radar_micro_agents (key, label, description, radar_type, focus_prompt, keywords, priority)
VALUES
  ('erp', 'ERP y gestión', 'Sistemas de planificación de recursos empresariales (SAP, Oracle, Dynamics, Totvs, etc.)', 'tech',
   'Buscá evidencia pública y verificable del ERP o sistema de gestión que usa la empresa. Priorizá casos de éxito del proveedor, notas de prensa, ofertas de empleo que mencionen el sistema y partners de implementación. Reportá versión/módulos si aparecen.',
   ARRAY['erp','sap','oracle ebs','oracle fusion','dynamics','totvs','netsuite','sistema de gestión','s/4hana'], 200),

  ('crm', 'CRM y ventas', 'Plataformas de gestión comercial y relación con clientes (Salesforce, HubSpot, Dynamics CRM)', 'tech',
   'Buscá qué CRM o plataforma de ventas/marketing usa la empresa. Priorizá casos de éxito del vendor, integraciones anunciadas y ofertas de empleo de roles comerciales que mencionen la herramienta.',
   ARRAY['crm','salesforce','hubspot','dynamics 365','pipedrive','zoho','marketing automation'], 190),

  ('cloud_hosting', 'Cloud e infraestructura', 'Proveedores de nube e infraestructura (AWS, Azure, GCP, on-premise)', 'tech',
   'Buscá evidencia del proveedor de nube o estrategia de infraestructura (AWS, Azure, GCP, híbrido, on-premise). Priorizá casos de estudio del cloud provider, ofertas de empleo de infraestructura/DevOps y anuncios de migración.',
   ARRAY['aws','azure','google cloud','gcp','cloud','nube','on-premise','datacenter','kubernetes'], 180),

  ('data_warehouse', 'Datos y data warehouse', 'Plataformas de datos, warehouses y lakes (Snowflake, Databricks, BigQuery, Redshift)', 'tech',
   'Buscá qué stack de datos usa la empresa (data warehouse, lake, ETL). Priorizá casos de éxito de Snowflake/Databricks/BigQuery, ofertas de empleo de data engineering y anuncios de proyectos de datos.',
   ARRAY['snowflake','databricks','bigquery','redshift','data warehouse','data lake','etl','data engineering'], 170),

  ('bi_analytics', 'BI y analítica', 'Herramientas de business intelligence y visualización (Power BI, Tableau, Qlik, Looker)', 'tech',
   'Buscá qué herramientas de BI/analítica usa la empresa. Priorizá casos de éxito del vendor, ofertas de empleo de analistas de datos/BI y publicaciones que mencionen dashboards o reporting.',
   ARRAY['power bi','tableau','qlik','looker','business intelligence','analítica','dashboards','reporting'], 160),

  ('cybersec_iam', 'Ciberseguridad e identidad', 'Seguridad informática, gestión de identidades y cumplimiento', 'tech',
   'Buscá evidencia de iniciativas, incidentes o proveedores de ciberseguridad e identidad (IAM, SOC, SIEM, certificaciones ISO 27001). Priorizá notas de prensa, certificaciones y ofertas de empleo de seguridad.',
   ARRAY['ciberseguridad','seguridad informática','iam','okta','soc','siem','iso 27001','identidad','zero trust'], 150),

  ('ai_rpa', 'IA y automatización', 'Inteligencia artificial, RPA y automatización de procesos', 'tech',
   'Buscá iniciativas de IA, machine learning o automatización de procesos (RPA). Priorizá anuncios de proyectos de IA, partnerships, ofertas de empleo de ML/automation y casos de uso publicados.',
   ARRAY['inteligencia artificial','ia','machine learning','rpa','uipath','automation anywhere','automatización','genai','copilot'], 145),

  ('ipaas_integrations', 'Integraciones e iPaaS', 'Plataformas de integración y middleware (MuleSoft, Boomi, APIs)', 'tech',
   'Buscá evidencia de plataformas de integración/iPaaS o estrategias de API. Priorizá casos de éxito de MuleSoft/Boomi, ofertas de empleo de integración y anuncios de proyectos de interoperabilidad.',
   ARRAY['mulesoft','boomi','ipaas','api management','middleware','integración','apis','webhooks'], 130),

  ('devops_platform', 'DevOps y plataforma', 'Prácticas y herramientas de DevOps, CI/CD y plataforma de ingeniería', 'tech',
   'Buscá evidencia de prácticas DevOps, CI/CD y tooling de plataforma. Priorizá ofertas de empleo de ingeniería de plataforma/SRE, repos públicos y charlas técnicas del equipo.',
   ARRAY['devops','ci/cd','gitlab','github actions','jenkins','terraform','sre','platform engineering'], 125),

  ('customer_service', 'Atención al cliente', 'Plataformas de servicio y soporte al cliente (Zendesk, Salesforce Service, contact center)', 'tech',
   'Buscá qué plataformas de atención al cliente/contact center usa la empresa. Priorizá casos de éxito del vendor, ofertas de empleo de soporte/CX y anuncios de mejoras de servicio.',
   ARRAY['zendesk','freshdesk','contact center','servicenow','atención al cliente','customer experience','soporte','omnicanal'], 120),

  ('communications', 'Comunicaciones y colaboración', 'Telefonía, colaboración y comunicaciones unificadas', 'tech',
   'Buscá evidencia de plataformas de comunicaciones/colaboración (Teams, Zoom, telefonía IP, contact center cloud). Priorizá anuncios, ofertas de empleo y casos de éxito.',
   ARRAY['microsoft teams','zoom','comunicaciones unificadas','telefonía ip','voip','colaboración','webex'], 110),

  ('workplace_productivity', 'Productividad y workplace', 'Suites de productividad y puesto de trabajo (Microsoft 365, Google Workspace)', 'tech',
   'Buscá qué suite de productividad y estrategia de puesto de trabajo usa la empresa (M365, Google Workspace, gestión de dispositivos). Priorizá ofertas de empleo de IT y anuncios de modernización del workplace.',
   ARRAY['microsoft 365','office 365','google workspace','workplace','productividad','endpoint','intune'], 100),

  ('news_business', 'Noticias y negocio', 'Noticias corporativas, resultados y movimientos de negocio', 'news',
   'Buscá noticias recientes y verificables de la empresa: resultados, contratos, alianzas, lanzamientos, cambios de estrategia. Cada hallazgo debe citar el medio y la fecha.',
   ARRAY['noticias','resultados','facturación','contrato','alianza','lanzamiento','negocio'], 90),

  ('expansion_investment', 'Expansión e inversión', 'Aperturas, inversiones, adquisiciones y crecimiento', 'news',
   'Buscá señales de expansión: nuevas plantas/oficinas, inversiones anunciadas, adquisiciones, rondas de financiamiento, licitaciones. Priorizá fuentes primarias con fecha reciente.',
   ARRAY['expansión','inversión','planta','adquisición','fusión','financiamiento','apertura','licitación'], 85),

  ('exec_changes', 'Cambios ejecutivos', 'Nombramientos y movimientos en la alta dirección', 'news',
   'Buscá nombramientos o cambios recientes en la dirección (CIO, CTO, CDO, CFO, CEO). Priorizá comunicados oficiales, LinkedIn y prensa especializada con fecha.',
   ARRAY['nombramiento','nuevo cio','nuevo cto','nuevo cfo','director','ejecutivo','designación'], 80),

  ('jobs_skills', 'Empleos y skills', 'Ofertas de empleo que revelan tecnologías y proyectos en curso', 'tech',
   'Analizá ofertas de empleo publicadas para inferir tecnologías en uso, proyectos activos y prioridades. Citá la fuente (portal de empleo) y la fecha de cada aviso.',
   ARRAY['ofertas de empleo','vacantes','linkedin jobs','skills','stack tecnológico','proyecto'], 70),

  ('public_contracts', 'Contratos y licitaciones', 'Contrataciones públicas y licitaciones tecnológicas', 'news',
   'Para empresas u organismos que participan de compras públicas, buscá licitaciones o contratos tecnológicos adjudicados o en curso. Citá el portal oficial y la fecha.',
   ARRAY['licitación','contratación pública','compra pública','adjudicación','pliego'], 60)
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE agent_count int;
BEGIN
  SELECT COUNT(*) INTO agent_count FROM v3.radar_micro_agents;
  RAISE NOTICE '[v0][migration 402] micro-agentes en catálogo: %', agent_count;
END $$;
