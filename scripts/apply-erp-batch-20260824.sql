-- Lote 2 del diccionario — ERP. Ejecutado el 24/08/2026.
-- Propuesta y evidencia en docs/auditoria-diccionario-tecnologia.md, seccion "Lote 2".
-- Respaldo previo del diccionario en dictionary_backup_20260824.
--
-- Resumen: 12 productos revisados, 4 productos nuevos, -159 keywords, +86 keywords,
-- -3.522 senales falsas. Las keywords nuevas quedaron encoladas como jobs add_keyword.

-- ---------------------------------------------------------------------------
-- 1. Productos nuevos, destino de los movimientos
-- ---------------------------------------------------------------------------
-- SAP BusinessObjects  — recibe el BI de SAP que estaba escondido en ECC y S/4HANA
-- SAP PI / PO          — el middleware, que estaba duplicado en ECC y S/4HANA
-- SAP Signavio         — venta separada, senal de transformacion en curso
-- Oracle Analytics Cloud — hizo falta como destino: el lote movia OAC fuera de
--                          Oracle HCM "al lote de Datos y BI", que todavia no existe
insert into dictionary_products (vendor_id, name, keywords) values
 (:sap_vendor,   'SAP BusinessObjects',
  array['SAP SAC','Web Intelligence','WebI','Universe Designer','Information Design Tool','SAP Lumira','SAP BW','SAP BW/4HANA']),
 (:sap_vendor,   'SAP PI / PO',    array['SAP XI','SAP Exchange Infrastructure','SAP CPI']),
 (:sap_vendor,   'SAP Signavio',   array['Signavio','Signavio Process Manager','Signavio Process Intelligence']),
 (:oracle_vendor,'Oracle Analytics Cloud',
  array['Oracle Analytics Server','Oracle BI EE','OBIEE','Oracle BI Publisher']);

-- ---------------------------------------------------------------------------
-- 2. Movimientos entre productos
-- Patron por cada (origen, keyword, destino):
--   a) agregar la keyword al destino si no la tiene
--   b) sacarla del origen
--   c) borrar del origen las senales que colisionarian con los unique de signals
--   d) mover el resto con update de signal_id
-- ---------------------------------------------------------------------------
-- SAP ECC / Business Suite -> SAP BusinessObjects : SAP BO, SAP BusinessObjects,
--                                                   SAP BOE, Crystal Reports SAP, SAP BEx
-- SAP ECC / Business Suite -> SAP PI / PO         : SAP PI, SAP PO,
--                                                   SAP Process Integration, SAP Process Orchestration
-- SAP S/4HANA              -> SAP BusinessObjects : SAP Analytics Cloud
-- SAP S/4HANA              -> SAP Signavio        : SAP Signavio
-- SAP S/4HANA              -> SAP PI / PO         : SAP PI, SAP PO, SAP Process Orchestration
-- Oracle EBS               -> Oracle Forms        : Oracle Reports
-- Oracle ERP Cloud         -> Oracle HCM Cloud    : Oracle HCM Cloud, Fusion HCM
-- Oracle ERP Cloud         -> Weblogic            : Oracle Fusion Middleware
-- Oracle HCM Cloud         -> Oracle Analytics Cloud : Oracle Analytics Cloud
-- Dynamics 365 CRM         -> Dynamics 365 ERP    : Dynamics 365 Business Central
--
-- Nota: SAP PI / PO recibio 231 senales y no 393 porque las que estaban en ECC y
-- en S/4HANA a la vez se dedujeron al converger. Ese era justamente el duplicado.

-- ---------------------------------------------------------------------------
-- 3. Bajas por falso positivo, verificadas contra snippets reales
-- ---------------------------------------------------------------------------
--  Order Management       Oracle EBS   664  "Order Management Analyst (Temporal) en Mondelez"
--  EC                     SuccessF.    368  "consultora EC Sistemas"
--  EDI                    SAP ECC      315  estandar de industria, no de SAP
--  RCM                    SuccessF.    289  "Ingeniero de Procesos (RCM - HUAWEI/ZTE)",
--                                           "Asset Management TPM RCM RCA" = Reliability Centered Maintenance
--  CTS                    SAP ECC      190  Compensacion por Tiempo de Servicios (PE):
--                                           "gratificaciones", "ingreso a planilla"
--  RFC                    SAP ECC      149  registro fiscal mexicano; lo cubren tRFC y qRFC
--  Investment Management  SAP ECC      149  "Investment Management Consultant" de banca
--  Transportation Mgmt    S/4HANA       82  "Consultor Certificado 2024 ORACLE Transportation Management OTM"
--  SAP Modules            SAP ECC       51  generico
--  SARA                   SAP ECC       52  nombre de persona
--  Setup and Maintenance  ERP Cloud     39  "NGS omics data pipeline", "SugarCRM plugins"
--  Smart View             ERP Cloud     34  generico
--  FSM                    HCM Cloud     29  Field Service Management, no Functional Setup Manager
--  Learning Mgmt System   SuccessF.     27  puede ser Moodle, Cornerstone, cualquiera
--  Workforce Analytics    SuccessF.     17  generico
--  Logistics Execution    SAP ECC       20  generico; SAP LE ya lo cubre
--  Report Writer          SAP ECC       13  generico
--  ALE                    SAP ECC       37  "Ale" es apodo de Alejandro -> reemplazada por SAP ALE
--  PCC / ECP / PMGM       SuccessF.    124  siglas ambiguas -> los nombres completos ya estaban
--  BI Publisher           ERP Cloud    299  ambigua EBS/Fusion -> Oracle BI Publisher
-- mas las genericas sin marca de S/4HANA (Business Technology Platform, Integration
-- Suite, Extended Warehouse Management, OData Services, Embedded Analytics,
-- Migration Cockpit, Core Data Services, Greenfield Implementation, Brownfield
-- Conversion), que ya existen con la marca adelante.

-- ---------------------------------------------------------------------------
-- 4. Bajas por construidas: combinaciones "producto + sufijo" que nadie escribe
-- ---------------------------------------------------------------------------
-- SAP ECC   14 con sufijo "ECC" (SAP Basis ECC, SolMan ECC, VC ECC, ...)
-- S/4HANA   28 combinatorias (S/4 MM, SAP S/4HANA Oil & Gas, ALE S/4, ...)
-- Ariba     19 submodulos; "Ariba" sola ya captura 739 de las 791 senales
-- Odoo      todas las "Odoo + modulo" sin una sola senal, mas el duplicado
--           literal ODOO/Odoo. Se conservan las versiones v14..v18 por cobertura futura.
-- Workday   44: las nueve "Workday to X", Workday Cloud/Platform/Tenant/Instance/SaaS,
--           Core HCM (generico) y las siglas WCP y WQL.
--
-- Criterio: se conserva la jerga real aunque tenga 0 senales (FNDLOAD, SE11,
-- SAP B1 SDK). No cuesta nada y cuando aparezca identifica a alguien que trabajo
-- de verdad con el producto. Solo se sacan las construcciones artificiales.

-- ---------------------------------------------------------------------------
-- 5. Altas: 86 keywords nuevas
-- ---------------------------------------------------------------------------
-- Los huecos mas grandes que tapan:
--   Workday no tenia la keyword "Workday". 51 keywords generaban 60 senales.
--   Dynamics 365 ERP no detectaba AX, NAV ni Navision, que es donde esta la base
--     instalada real de Microsoft ERP en LatAm.
--   NetSuite tenia una sola keyword; se sumo toda la familia Suite* (SuiteScript,
--     SuiteFlow, SuiteTalk), que es jerga exclusiva.
--   Faltaba "RISE with SAP": nadie lo menciona salvo que la cuenta este migrando.
--   Faltaba "OpenERP", el nombre viejo de Odoo, que sigue en perfiles pre-2014.
--
-- No entraron, por las reglas del metodo:
--   HDL (Oracle HCM) y SBO (Business One): siglas de tres letras. HDL ademas es
--     un tipo de colesterol. HCM Data Loader escrito completo si entro.
--   X++ (Dynamics): termina en simbolo, el motor nunca la matchearia. Se puso
--     AX Developer en su lugar.
--   Las keywords en espanol (Consultor Odoo, Modulo SAP, Soporte SAP): suben
--     cobertura pero bajan precision.

-- Las altas se encolan para que generen senales:
insert into dictionary_jobs (job_type, signal_id, signal_type, keyword, status, created_by)
select 'add_keyword', p.id, 'technology', k.kw, 'pending', 'auditoria-diccionario-20260824'
from dictionary_products p cross join lateral unnest(p.keywords) k(kw)
where not exists (select 1 from signals s
                  where s.signal_id = p.id and s.signal_type = 'technology'
                    and lower(s.keyword_matched) = lower(k.kw))
  and not exists (select 1 from dictionary_jobs j
                  where j.signal_id = p.id and j.job_type = 'add_keyword'
                    and lower(j.keyword) = lower(k.kw));
-- 111 jobs. Las otras 142 keywords sin senales ya tenian un job completado que
-- matcheo cero, asi que no valia reprocesarlas.
-- El cron process-dictionary corre cada minuto y las procesa solo.

-- ---------------------------------------------------------------------------
-- 6. Limpieza de senales que quedaron sin keyword
-- ---------------------------------------------------------------------------
delete from signals s
using dictionary_products p
where s.signal_id = p.id
  and s.signal_type = 'technology'
  and not exists (select 1 from unnest(p.keywords) k where lower(k) = lower(s.keyword_matched));

-- ---------------------------------------------------------------------------
-- Estado final: 85 productos · 3.128 keywords · 281.633 senales · 0 huerfanas
-- ---------------------------------------------------------------------------
