-- Rediseño de la taxonomía del diccionario: tres ejes en vez de uno.
-- Propuesta y fundamentos en docs/rediseno-taxonomia-diccionario.md
--
-- El modelo tenía una sola dimensión (vendor) y el negocio hace tres preguntas:
--   ¿qué cuentas tienen SAP?            -> vendor      (ya se podía)
--   ¿qué cuentas tienen un ERP?         -> categoria   (no se podía)
--   ¿qué cuentas tienen algo a modernizar? -> ciclo_vida (no se podía)
--
-- Cuatro de los 27 vendors eran categorías disfrazadas (Legacy, Backend,
-- Frontend, CMS). Esta migración no los "corrige": agrega los ejes que
-- faltaban y los disuelve.
--
-- No toca keywords ni signals: no hay reprocesamiento del ETL.

-- ---------------------------------------------------------------------------
-- 1. Los dos ejes nuevos
-- ---------------------------------------------------------------------------
alter table public.dictionary_products
  add column if not exists categoria text,
  add column if not exists ciclo_vida text not null default 'vigente';

alter table public.dictionary_products
  drop constraint if exists dictionary_products_ciclo_vida_check;
alter table public.dictionary_products
  add constraint dictionary_products_ciclo_vida_check
  check (ciclo_vida in ('vigente','legado'));

create index if not exists idx_dictionary_products_categoria on public.dictionary_products (categoria);
create index if not exists idx_dictionary_products_ciclo_vida on public.dictionary_products (ciclo_vida);

comment on column public.dictionary_products.categoria is
  'Para que sirve el producto. Eje de busqueda independiente del vendor: permite responder "que cuentas tienen un ERP" sin saber la marca.';
comment on column public.dictionary_products.ciclo_vida is
  'vigente | legado. Se marca legado SOLO cuando el propio vendor anuncio sucesor y fin de soporte. Es el eje de oportunidad de modernizacion.';

-- ---------------------------------------------------------------------------
-- 2. Backfill de los 90 productos
--    Criterio de categoria: cada una corresponde a una conversacion comercial
--    distinta. Si dos grupos se le venden a la misma persona con el mismo
--    argumento, son una sola categoria.
--    Criterio de legado (estricto, para que no sea una opinion): solo si el
--    propio vendor anuncio un sucesor y una fecha de fin de soporte.
-- ---------------------------------------------------------------------------
with mapa(prod, categoria, ciclo) as (values
 ('SAP ECC / Business Suite','ERP y backoffice','legado'),('SAP S/4HANA','ERP y backoffice','vigente'),
 ('SAP Business One','ERP y backoffice','vigente'),('SAP Ariba','ERP y backoffice','vigente'),
 ('SAP SuccessFactors','ERP y backoffice','vigente'),('Oracle E-Business Suite (EBS)','ERP y backoffice','legado'),
 ('Oracle ERP Cloud','ERP y backoffice','vigente'),('Oracle HCM Cloud','ERP y backoffice','vigente'),
 ('Oracle NetSuite','ERP y backoffice','vigente'),('Dynamics 365 ERP','ERP y backoffice','vigente'),
 ('ODOO ERP','ERP y backoffice','vigente'),('Workday Financial & HCM','ERP y backoffice','vigente'),
 ('AWS','Cloud e infraestructura','vigente'),('Azure','Cloud e infraestructura','vigente'),
 ('Google Cloud Platform','Cloud e infraestructura','vigente'),('Microsoft SQL Server','Cloud e infraestructura','vigente'),
 ('Oracle Database','Cloud e infraestructura','vigente'),('Microsoft Windows Server','Cloud e infraestructura','vigente'),
 ('SAP PI / PO','Cloud e infraestructura','vigente'),
 ('Microsoft System Center Configuration Manager','Cloud e infraestructura','legado'),
 ('Weblogic','Cloud e infraestructura','legado'),('IBM WebSphere','Cloud e infraestructura','legado'),
 ('AS/400','Cloud e infraestructura','legado'),('IBM Z','Cloud e infraestructura','legado'),
 ('Java','Desarrollo','vigente'),('Python','Desarrollo','vigente'),('PHP','Desarrollo','vigente'),
 ('JavaScript / TypeScript','Desarrollo','vigente'),('React','Desarrollo','vigente'),('Angular','Desarrollo','vigente'),
 ('Vue.js','Desarrollo','vigente'),('Next.js','Desarrollo','vigente'),('Flutter','Desarrollo','vigente'),
 ('Ionic','Desarrollo','vigente'),('NodeJS / Express.Js','Desarrollo','vigente'),('Spring Boot','Desarrollo','vigente'),
 ('Django','Desarrollo','vigente'),('Flask','Desarrollo','vigente'),('Ruby on Rails','Desarrollo','vigente'),
 ('ASP.NET Core','Desarrollo','vigente'),('Wordpress','Desarrollo','vigente'),
 ('Visual Basic','Desarrollo','legado'),('Delphi','Desarrollo','legado'),('Cobol','Desarrollo','legado'),
 ('Oracle Forms','Desarrollo','legado'),('Microfocus','Desarrollo','legado'),
 ('Power BI','Datos y BI','vigente'),('Microsoft Fabric','Datos y BI','vigente'),
 ('Tableau Desktop y Server','Datos y BI','vigente'),('Qlik Sense & Qlikview','Datos y BI','vigente'),
 ('Talend','Datos y BI','vigente'),('Google Looker','Datos y BI','vigente'),('MicroStrategy','Datos y BI','vigente'),
 ('SAS Viya y SAS 9','Datos y BI','vigente'),('Oracle Analytics Cloud','Datos y BI','vigente'),
 ('SAP BusinessObjects','Datos y BI','vigente'),('SAP Crystal Reports','Datos y BI','vigente'),
 ('Microsoft 365','Productividad y colaboracion','vigente'),('Microsoft Sharepoint','Productividad y colaboracion','vigente'),
 ('Copilot (GitHub y Microsoft 365)','Productividad y colaboracion','vigente'),
 ('Google Workspace','Productividad y colaboracion','vigente'),('Jira','Productividad y colaboracion','vigente'),
 ('Confluence','Productividad y colaboracion','vigente'),('Trello','Productividad y colaboracion','vigente'),
 ('Bitbucket y Bamboo','Productividad y colaboracion','vigente'),
 ('Atlassian (producto sin identificar)','Productividad y colaboracion','vigente'),
 ('Elo Digital Office','Productividad y colaboracion','vigente'),
 ('Microsoft Exchange Server','Productividad y colaboracion','legado'),
 ('Sales Cloud','CRM y marketing','vigente'),('Service Cloud','CRM y marketing','vigente'),
 ('Marketing Cloud','CRM y marketing','vigente'),('Commerce Cloud','CRM y marketing','vigente'),
 ('HubSpot CRM & Marketing Hub','CRM y marketing','vigente'),('Dynamics 365 CRM','CRM y marketing','vigente'),
 ('Zoho','CRM y marketing','vigente'),
 ('Microsoft Sentinel','Ciberseguridad e identidad','vigente'),('Microsoft Defender','Ciberseguridad e identidad','vigente'),
 ('Purview','Ciberseguridad e identidad','vigente'),('Microsoft Entra','Ciberseguridad e identidad','vigente'),
 ('Intune','Ciberseguridad e identidad','vigente'),('Palo Alto Networks','Ciberseguridad e identidad','vigente'),
 ('Sentinel One','Ciberseguridad e identidad','vigente'),('Check Point','Ciberseguridad e identidad','vigente'),
 ('Microsoft Power Apps','Automatizacion y low-code','vigente'),
 ('Microsoft Power Automate','Automatizacion y low-code','vigente'),
 ('Automation Anywhere','Automatizacion y low-code','vigente'),('SAP Signavio','Automatizacion y low-code','vigente'),
 ('ServiceNow ITSM','Observabilidad y gestion de servicios','vigente'),
 ('Datadog','Observabilidad y gestion de servicios','vigente'),
 ('Dynatrace','Observabilidad y gestion de servicios','vigente')
)
update public.dictionary_products p
set categoria = m.categoria, ciclo_vida = m.ciclo, updated_at = now()
from mapa m where m.prod = p.name;

-- Java queda VIGENTE a proposito. Oracle audita el licenciamiento de Java SE
-- desde 2023, lo que es exposicion comercial, no obsolescencia. Mezclarlo
-- ensuciaria el eje: sus 11.728 cuentas aportan solo 3 cuentas unicas al total
-- de legado, asi que tampoco cuesta nada dejarlo afuera.

-- ---------------------------------------------------------------------------
-- 3. Vendors: la regla es "quien te lo puede vender"
--    No quien lo fabrico ni quien lo mantiene en GitHub, sino con quien puede
--    tener un contrato la cuenta. Si no hay a quien comprarle, vendor_id NULL.
-- ---------------------------------------------------------------------------
insert into public.dictionary_vendors (name) values ('IBM'), ('Micro Focus / OpenText'), ('Embarcadero')
on conflict do nothing;

update public.dictionary_vendors set name = btrim(name) where name <> btrim(name);

with asign(prod, vendor) as (values
 ('Java','Oracle'),
 ('IBM Z','IBM'),('AS/400','IBM'),('IBM WebSphere','IBM'),
 ('Cobol','Micro Focus / OpenText'),('Microfocus','Micro Focus / OpenText'),
 ('Delphi','Embarcadero'),
 ('Visual Basic','Microsoft'),('ASP.NET Core','Microsoft')
)
update public.dictionary_products p set vendor_id = v.id, updated_at = now()
from asign a join public.dictionary_vendors v on v.name = a.vendor
where a.prod = p.name;

update public.dictionary_products p set vendor_id = null, updated_at = now()
where p.name in ('React','Angular','Vue.js','Next.js','Flutter','Ionic','NodeJS / Express.Js','Python','PHP',
                 'Django','Flask','Ruby on Rails','Spring Boot','JavaScript / TypeScript','Wordpress');

delete from public.dictionary_vendors v
where v.name in ('Legacy','Backend','Frontend','CMS')
  and not exists (select 1 from public.dictionary_products p where p.vendor_id = v.id);

-- ---------------------------------------------------------------------------
-- Estado resultante: 90 productos, 0 sin categoria, 13 en legado sobre 14.005
-- cuentas distintas. 26 vendors reales + 15 productos sin vendor comercial.
-- ---------------------------------------------------------------------------
