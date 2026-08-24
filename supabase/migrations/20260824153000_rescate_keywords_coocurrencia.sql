-- ═══════════════════════════════════════════════════════════════════
-- Primeras cinco keywords rescatadas con co-ocurrencia
--
-- Las cinco se habían BORRADO en los siete lotes de limpieza por ruidosas.
-- Con contexto y exclusiones vuelven, medidas una por una sobre el corpus
-- (contactos que mencionan la palabra como palabra suelta):
--
--   keyword         crudo   tras excl.   final   muestra revisada
--   Fabric            556          376     123   43/45 correctas (96%)
--   Exchange        4.927        3.814   2.238   44/45 correctas (98%)
--   Pub/Sub           166          166     140   contexto GCP, 84%
--   Commerce Cloud     188          127     100   24/25 correctas (96%)
--   Web Forms         211          211     191   24/25 correctas (96%)
--
-- El criterio es el mismo que se viene usando en toda la auditoría: la razón
-- entre señales identificablemente reales y falsas sobre una muestra leída,
-- con umbral de 80:20. Las cinco quedan bastante por encima.
--
-- Dos notas sobre cómo se armaron las listas:
--
--  1. Los términos de contexto se eligieron midiendo el aporte marginal de
--     cada uno, no por intuición. Para Fabric se descartaron "Business
--     Intelligence", "Data Engineer" y "Warehouse" aunque sumaban 26
--     perfiles: al leerlos, la mitad eran textiles ("fabric samples",
--     "fabric roll") y Fabric Care de P&G. Un término de contexto que ensancha
--     la red sin discriminar no sirve.
--
--  2. Varias exclusiones salieron de leer los que sobrevivían al primer
--     filtro, no de pensarlas de antemano: "Fabric UI" (el CSS de Office),
--     "Fabric Manager" (Cisco), "K2View Fabric", "urban fabric", "Fabric
--     Controller" (Azure), "e-commerce cloud". Medir lo que se AGREGA, no
--     solo lo que se saca, es lo que las encontró.
--
-- Los jobs al final reprocesan las cinco keywords. Son idempotentes: las
-- señales tienen unicidad por (contacto, empresa, tipo, producto).
-- ═══════════════════════════════════════════════════════════════════

update public.dictionary_products set
  keywords_contexto = '{"Fabric": ["Power BI", "Synapse", "OneLake", "Lakehouse", "Data Factory", "Databricks", "DAX", "Power Query", "DP-600", "DP-700", "Direct Lake", "Dataflow Gen2"]}'::jsonb,
  keywords_excluye  = '{"Fabric": ["Service Fabric", "Hyperledger Fabric", "Data Fabric", "network fabric", "fabric topology", "fabric topologies", "Fabric Care", "switch fabric", "fabric switch", "storage fabric", "Fabric Interconnect", "SAN fabric", "IP fabric", "Ethernet fabric", "fabric de red", "Security Fabric", "Fortinet Fabric", "Fabric UI", "Office UI Fabric", "Fluent UI", "Fabric Manager", "K2View Fabric", "K2VIEW Fabric", "urban fabric", "Fabric Controller", "Fabric.com", "EY Fabric", "Bluemix Fabric", "Fabric Softener", "Fabric Softeners", "Fabric & Home", "Fabric and Home", "Fabric Roll", "social fabric", "tejido"]}'::jsonb,
  keywords = (select array_agg(distinct k order by k) from unnest(keywords || array['Fabric']) k)
where id = '9018451b-5451-4729-ae09-42c7e4f669b5'; -- Microsoft Fabric

update public.dictionary_products set
  keywords_contexto = '{"Exchange": ["Outlook", "Office 365", "Microsoft 365", "O365", "M365", "Active Directory", "Directorio Activo", "mailbox", "mailboxes", "buzon", "buzón", "buzones", "SMTP", "OWA", "Mail Flow", "Entra ID", "Azure AD", "Windows Server", "Microsoft Exchange", "correo electronico", "correo electrónico", "correo corporativo"]}'::jsonb,
  keywords_excluye  = '{"Exchange": ["exchange rate", "exchange rates", "stock exchange", "foreign exchange", "exchange program", "exchange programs", "exchange student", "exchange students", "exchange traded", "data exchange", "information exchange", "key exchange", "exchange of", "heat exchanger", "heat exchangers", "exchange offer", "currency exchange", "crypto exchange", "cripto exchange", "exchange cripto", "exchange de criptomonedas", "criptomonedas exchange", "intercambio", "file exchange", "message exchange", "exchange listing", "health information exchange"]}'::jsonb,
  keywords = (select array_agg(distinct k order by k) from unnest(keywords || array['Exchange']) k)
where id = '7d6b975b-619a-425e-b0bf-19471ab8e559'; -- Microsoft Exchange Server

update public.dictionary_products set
  keywords_contexto = '{"Pub/Sub": ["GCP", "Google Cloud", "BigQuery", "Dataflow", "Cloud Functions", "Cloud Run", "GKE", "App Engine", "Cloud Storage", "Dataproc", "Cloud Composer", "Vertex AI"]}'::jsonb,
  keywords = (select array_agg(distinct k order by k) from unnest(keywords || array['Pub/Sub']) k)
where id = '851f348c-8568-421d-aa6a-cf066d280cd4'; -- Google Cloud Platform

update public.dictionary_products set
  keywords_contexto = '{"Commerce Cloud": ["Salesforce", "Demandware", "SFCC", "SFRA", "OCAPI", "ISML", "Apex", "Lightning Web Components", "Sales Cloud", "Service Cloud", "Marketing Cloud", "Experience Cloud"]}'::jsonb,
  keywords_excluye  = '{"Commerce Cloud": ["SAP Commerce Cloud", "Oracle Commerce Cloud", "Adobe Commerce Cloud", "Magento Commerce Cloud", "VTEX Commerce Cloud", "Sitecore Commerce Cloud", "Hybris Commerce Cloud", "Intershop Commerce Cloud", "commercetools", "SAP Commerce", "Oracle Commerce", "Adobe Commerce", "e-commerce cloud", "ecommerce cloud"]}'::jsonb,
  keywords = (select array_agg(distinct k order by k) from unnest(keywords || array['Commerce Cloud']) k)
where id = '3ebd65ac-87cc-4bf3-91fe-7413ebd096da'; -- Commerce Cloud (Salesforce)

update public.dictionary_products set
  keywords_contexto = '{"Web Forms": ["ASP.NET", ".NET", "C#", "VB.NET", "Visual Studio", "IIS", "WebForms", "ASPX", ".NET Framework", "Windows Forms"]}'::jsonb,
  keywords_excluye  = '{"Web Forms": ["Google Forms", "JotForm", "Typeform", "Gravity Forms", "Contact Form 7", "Wufoo", "HubSpot forms"]}'::jsonb,
  keywords = (select array_agg(distinct k order by k) from unnest(keywords || array['Web Forms']) k)
where id = '02d636be-9e99-4280-a62e-dda101aa4b26'; -- .NET Framework y escritorio

insert into public.dictionary_jobs (job_type, signal_id, signal_type, keyword, status) values
  ('add_keyword','9018451b-5451-4729-ae09-42c7e4f669b5','technology','Fabric','pending'),
  ('add_keyword','7d6b975b-619a-425e-b0bf-19471ab8e559','technology','Exchange','pending'),
  ('add_keyword','851f348c-8568-421d-aa6a-cf066d280cd4','technology','Pub/Sub','pending'),
  ('add_keyword','3ebd65ac-87cc-4bf3-91fe-7413ebd096da','technology','Commerce Cloud','pending'),
  ('add_keyword','02d636be-9e99-4280-a62e-dda101aa4b26','technology','Web Forms','pending');
