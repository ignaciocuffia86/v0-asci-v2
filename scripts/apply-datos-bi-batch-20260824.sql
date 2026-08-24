-- Lote 5 del diccionario — Datos y BI. Ejecutado el 24/08/2026.
-- Diez productos: Power BI, Microsoft Fabric, Tableau, Qlik, Talend, Google Looker,
-- MicroStrategy, SAS, Oracle Analytics Cloud y SAP BusinessObjects
-- (los dos ultimos creados en los lotes de ERP y cloud).

-- ---------------------------------------------------------------------------
-- 1. Lo que se midio antes de tocar nada
-- ---------------------------------------------------------------------------
-- Cuatro keywords de una sola palabra que sostienen casi todo el volumen del lote.
-- Tres pasaron el umbral de ~80:20 y una no:
--
--   tableau   3.184   1.906 con contexto BI  /  1 claramente otra cosa   -> se queda
--   looker      884     504 con contexto BI  /  1 claramente otra cosa   -> se queda
--   fabric      631     164 con contexto Fabric / 80 de redes, textil,
--                       "AWS Edge Fabric", "switching y routing"  = 67:33 -> SALE
--
-- Fabric es el caso de libro del problema: Microsoft le puso a su producto una
-- palabra que ya significaba otra cosa en dos industrias (textil) y en redes
-- (switch fabric, service fabric). Queda "Microsoft Fabric" y entran las formas
-- cortas inequivocas: OneLake, Direct Lake, Fabric Lakehouse, Fabric Warehouse.

-- ---------------------------------------------------------------------------
-- 2. Bajas por falso positivo
-- ---------------------------------------------------------------------------
--   Fabric        Microsoft Fabric  631  67:33, ver arriba
--   Data Manager  Qlik              409  es un puesto, no un producto. Solo 22 de 409
--                                        con contexto BI; los snippets dicen
--                                        "Technical Data Manager", "Clinical Data
--                                        Manager Assistant"
--   Dossiers      MicroStrategy      39  cero contexto BI: "Press & Communications
--                                        Department", "Asuntos Regulatorios",
--                                        "Document Control". Se reemplaza por
--                                        "MicroStrategy Dossier" en singular
--   Strategy One  MicroStrategy       2  frase generica
--   Data Model Viewer, Data Load Editor  Qlik  0  nombres de pantalla que leen genericos
--
-- Ademas se deduplico "Microstrategy"/"MicroStrategy", que para un motor
-- case-insensitive es la misma keyword cargada dos veces.

-- ---------------------------------------------------------------------------
-- 3. Nubes reemplazadas enteras
-- ---------------------------------------------------------------------------
-- Google Looker  18 -> 10   sacadas las combinatorias sin senal (Looker BI, Looker
--                           Analytics, Looker Data Platform, Looker REST API...)
-- SAS            79 -> 56   sacadas las verticales inventadas sin una sola senal
--                           (SAS Tax Fraud, SAS Social Benefits Analytics, SAS Claims
--                           Fraud, SAS Public Security, SAS Stress Testing...) y
--                           sumadas las que faltaban: SAS Studio, SAS EG, Base SAS.
--                           Renombrado de "Viya Platform" a "SAS Viya y SAS 9":
--                           el producto cubre las dos generaciones, no solo Viya.
--
-- Nota: "SAS" a secas NO se agrego a proposito. En LatAm es "Sociedad por Acciones
-- Simplificada" y aparece en miles de razones sociales.

-- ---------------------------------------------------------------------------
-- 4. Altas
-- ---------------------------------------------------------------------------
--   Power BI     DAX, Power Query, PBIX, PL-300, Power BI Dataflows,
--                Power BI Report Builder, Tabular Editor, RLS Power BI,
--                Power BI Paginated Reports
--   Fabric       MS Fabric, OneLake, Direct Lake, Fabric Lakehouse, Fabric Warehouse,
--                Fabric Capacity, Fabric Notebooks, Fabric Data Factory, DP-600
--   Tableau      Tableau Certified, Tableau Desktop Specialist, LOD Expressions, Tableau Hyper
--   Qlik         Qlik, QlikView Scripting, NPrinting
--   Talend       Talend Administration Center, tMap, Talend Job Designer
--   MicroStrategy  MicroStrategy Dossier, MicroStrategy Certified
--   Oracle Analytics  Oracle Analytics, Oracle BI Answers, OBIA, Oracle BI Server
--   SAP BO       BEx Analyzer, SAP Datasphere, BW/4HANA, SAP BW4HANA, Crystal Reports
--
-- No entro "OAS" para Oracle Analytics Server: en ingles es tambien Organization
-- of American States.

-- ---------------------------------------------------------------------------
-- 5. Verificacion de las altas: Crystal Reports termino en producto propio
-- ---------------------------------------------------------------------------
-- Se agrego "Crystal Reports" a SAP BusinessObjects — es un producto de SAP.
-- El job trajo 974 senales, casi duplicando el producto. Al revisar:
--
--   select count(*) from signals s join dictionary_products p on p.id=s.signal_id
--   where p.name='SAP BusinessObjects' and lower(s.keyword_matched)='crystal reports'
--     and exists (select 1 from signals s2 where s2.contact_id=s.contact_id
--                   and s2.signal_id=p.id and lower(s2.keyword_matched)<>'crystal reports');
--   -- 17 de 974
--
-- Solo 17 de los 974 contactos tienen alguna otra senal de BusinessObjects. Los
-- otros 957 escriben "Crystal Reports" y nada mas de la plataforma. Tiene sentido:
-- Crystal Reports se vende suelto y lo usa gente que no tiene ni va a tener
-- BusinessObjects. Como senal comercial son dos cuentas distintas.
--
-- Solucion: producto propio "SAP Crystal Reports". La senal no se pierde, deja de
-- disfrazarse. De paso salio "SAP Crystal Reports" de adentro de SAP Business One,
-- donde estaba por la misma confusion.
--
-- OJO al mover senales entre productos: el dedup tiene que cubrir las colisiones
-- DENTRO del conjunto que se mueve, no solo contra el destino. Tres keywords
-- distintas del mismo contacto convergen en la misma fila destino y violan
-- unique_signal_per_contact_company_dict.
insert into dictionary_products (vendor_id, name, keywords)
select vendor_id, 'SAP Crystal Reports',
 array['Crystal Reports','SAP Crystal Reports','Crystal Reports SAP',
       'Crystal Reports Developer','Crystal Reports Designer','Crystal Reports .NET']
from dictionary_products where name='SAP BusinessObjects';

delete from signals where ctid in (
  select ctid from (
    select s.ctid, row_number() over (
      partition by s.contact_id, s.company_id, s.job_posting_id, s.signal_type
      order by s.created_at) rn
    from signals s
    where s.signal_type='technology'
      and lower(s.keyword_matched) in ('crystal reports','crystal reports sap','sap crystal reports')
      and s.signal_id in (select id from dictionary_products
                          where name in ('SAP BusinessObjects','SAP Business One'))
  ) t where rn > 1);

update signals set signal_id=(select id from dictionary_products where name='SAP Crystal Reports')
where signal_type='technology'
  and lower(keyword_matched) in ('crystal reports','crystal reports sap','sap crystal reports')
  and signal_id in (select id from dictionary_products where name in ('SAP BusinessObjects','SAP Business One'));

-- ---------------------------------------------------------------------------
-- Resultado del lote
-- ---------------------------------------------------------------------------
--   Power BI                10.536 -> 11.157 senales   4.817 cuentas
--   Tableau                  3.219 ->  3.222           1.550
--   Qlik Sense & QlikView    1.450 ->  1.795           1.184
--   SAP BusinessObjects      1.459 ->  1.491             945
--   Google Looker            1.042 ->  1.301             687
--   SAP Crystal Reports (nuevo)     ->    979             854
--   MicroStrategy              767 ->    727             440
--   Oracle Analytics Cloud     651 ->    727             479
--   Talend                     260 ->    264             205
--   SAS Viya y SAS 9           172 ->    194             144
--   Microsoft Fabric           648 ->     45              41
--
-- Power BI gano 621 senales solo con DAX (321) y Power Query (293). Las dos se
-- midieron: 271 de las 321 de DAX tienen contexto BI y ninguna tiene contexto
-- bursatil, que era el riesgo (DAX es tambien el indice de Frankfurt).
--
-- Qlik subio a pesar de perder 409 senales: sacar "Data Manager" y agregar "Qlik"
-- a secas dio saldo +345. Mismo patron que IBM Z en el lote de cloud: la keyword
-- que faltaba valia mas que las que sobraban.
--
-- Microsoft Fabric cae de 397 cuentas a 41 y es correcto: el producto salio en
-- 2023, que 397 cuentas de LatAm ya lo tuvieran era implausible.
