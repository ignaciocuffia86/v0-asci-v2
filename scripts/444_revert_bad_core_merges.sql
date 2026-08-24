-- =============================================================================
-- 444 - Reversion de los merges que fabrico el nucleo truncado
-- =============================================================================
--
-- Depende de 443, que corrige `company_core_name`. Este script repara lo que la
-- version vieja ya habia unificado mal en produccion.
--
-- COMO SE ENCONTRARON
--
-- Con la funcion ya corregida, se recalculo el nucleo del nombre de la empresa
-- duplicada y el de su master para los 1.426 merges historicos. Si con el
-- nucleo BUENO los dos nombres ya no caen en el mismo grupo, ese merge existio
-- solamente por el truncado. Dieron 27 casos (2% de los auto-merges).
--
-- De los 27, catorce son empresas distintas y se revierten. Los otros trece son
-- correctos y se dejan: son variantes de escritura donde el truncado acerto por
-- casualidad ("Pepsi co" / "PepsiCo", "FAPA SA" / "FAPASA", "CENSUSA" /
-- "Censu S.A.", "Citicorp" / "Citi", "Banco del SolS.A." / "Banco del Sol",
-- "Mapy SA" / "mapysa", "Grupo Colineal" / "ColinealCorp").
--
-- LOS CATORCE QUE SE REVIERTEN
--
--   ALICO          -> Alicorp      la aseguradora contra la alimenticia peruana
--   Farma S.A      -> Farmacorp    (dos merges, "Farma S.A" y "Farma S.A.")
--   Capco          -> Grupo CAP    consultora contra la siderurgica chilena
--   Grupo capsa    -> Grupo CAP    CAPSA es petrolera, CAP es acero
--   Capsa / Capex  -> Grupo CAP
--   Dat            -> Grupo Datco
--   ADEC           -> Adecco       ADEC es la asociacion de empresarios paraguaya
--   sapsa          -> SAP          SAPSA no tiene nada que ver con el ERP aleman
--   CICCO          -> CIC
--   DREAM S.R.L    -> DREAMCO
--   Dream S.A.     -> DREAMCO
--   Reyco          -> Grupo Rey
--   CRE s.r.l.     -> Cresa
--
-- CUATRO QUE QUEDARON SIN TOCAR, A PROPOSITO
--
-- SIDSA/Grupo SID, COFRA/Cofrasa, BEP/Bepsa y CICSA/CIC son plausibles como
-- "X" + "S.A." escrito sin separar. No hay evidencia para decidirlos desde la
-- base y revertir de mas tambien rompe. Quedan unificados y anotados aca para
-- que los mire una persona.
--
-- EL CASO ESPECIAL: ALICO Y REYCO
--
-- `revert_company_merge` reinserta la fila borrada con su UUID original. Para
-- estos dos fallo con 23505 sobre `companies_name_key`: despues del merge, el
-- ETL volvio a crear "ALICO" (2026-08-06) y "Reyco" (2026-08-06) como empresas
-- nuevas, asi que el nombre ya estaba ocupado por OTRA fila.
--
-- Revertir habria duplicado el nombre. La reparacion correcta no es restaurar
-- la fila vieja sino reapuntar los datos que se habian movido de mas hacia la
-- fila que hoy existe. Las dos solo habian movido `signals`:
--   ALICO: 9 senales  ->  5adb6c73-98cb-42a6-939e-bdce3a09c534
--   Reyco: 1 senal    ->  9a6923d7-d492-4bb2-b9b2-323f438369b1
--
-- Una de las de Reyco ya existia en la fila nueva (choca el UNIQUE
-- contact+company+signal_type+signal_id) y se borro por duplicada. Los dos
-- registros de v3.company_merges se eliminaron: ya no describen un merge
-- vigente y dejarlos habilitaba un segundo revert que si habria roto.
--
-- IDEMPOTENCIA: los revert ya aplicados fallan con "no existe el merge". El
-- script se puede releer como documentacion, no como algo a re-ejecutar.
-- =============================================================================

BEGIN;

SELECT public.revert_company_merge('e1eda160-1785-4054-84b1-c6c81ff1a1d2'); -- Farma S.A.   -> Farmacorp
SELECT public.revert_company_merge('20240e69-2d3a-4ec3-923e-e6f02e3a672f'); -- Farma S.A    -> Farmacorp
SELECT public.revert_company_merge('e28ee1d1-5e06-4d0d-b940-b10bb1e9a255'); -- Capco        -> Grupo CAP
SELECT public.revert_company_merge('e82ba8fb-0bd8-4ccb-a827-c64a757df60e'); -- Grupo capsa  -> Grupo CAP
SELECT public.revert_company_merge('b2b54e2c-43d2-4118-894d-715e909c5864'); -- Capsa / Capex-> Grupo CAP
SELECT public.revert_company_merge('123f9a22-e4fa-48c0-a2b6-4d6a13542239'); -- Dat          -> Grupo Datco
SELECT public.revert_company_merge('397c6937-243d-47be-8961-dc75b28b26e9'); -- ADEC         -> Adecco
SELECT public.revert_company_merge('00650abe-0266-4cff-a348-9cb9d881e041'); -- sapsa        -> SAP
SELECT public.revert_company_merge('bd3c08ce-89a8-4baf-a66c-9ba9d7a6e264'); -- CICCO        -> CIC
SELECT public.revert_company_merge('48f200f6-146f-48a4-ad14-61f889cc9c6c'); -- DREAM S.R.L  -> DREAMCO
SELECT public.revert_company_merge('eab31c3c-64ce-4055-8fed-cc1ff8a457f8'); -- Dream S.A.   -> DREAMCO
SELECT public.revert_company_merge('933fe946-79b3-4000-a5f4-4f3a84f5024e'); -- CRE s.r.l.   -> Cresa

-- ── ALICO y Reyco: reparacion manual (ver cabecera) ─────────────────────────
--
-- Primero se sacan las senales que chocarian con una que la fila nueva ya
-- tiene. El `t.id <> s.id` evita que una fila se detecte a si misma como
-- conflicto cuando ya esta en el destino (hace el paso reintentable).

WITH objetivo(sig, destino) AS (VALUES
  ('fa9e34ab-cd43-4383-a702-11a0bf19b0b7'::uuid,'5adb6c73-98cb-42a6-939e-bdce3a09c534'::uuid),
  ('9b9ba694-e0eb-43b7-a840-71c76413a948','5adb6c73-98cb-42a6-939e-bdce3a09c534'),
  ('76bd4019-c120-4a3a-9c79-d1852985dc4d','5adb6c73-98cb-42a6-939e-bdce3a09c534'),
  ('f49288ff-2650-4885-8032-398a0e68c3e3','5adb6c73-98cb-42a6-939e-bdce3a09c534'),
  ('6057b0cf-c3d4-4dd3-8339-8194ff859db7','5adb6c73-98cb-42a6-939e-bdce3a09c534'),
  ('0c56d4a1-c529-4639-8e70-90a3b0406c95','5adb6c73-98cb-42a6-939e-bdce3a09c534'),
  ('207feab7-13aa-451c-9e82-23a7c5a9a5d4','5adb6c73-98cb-42a6-939e-bdce3a09c534'),
  ('3198d8c4-21c4-4eee-83c0-7e1506b24623','5adb6c73-98cb-42a6-939e-bdce3a09c534'),
  ('138b07cb-e27c-4740-96ca-a0cb2a1737a7','5adb6c73-98cb-42a6-939e-bdce3a09c534'),
  ('7c5b0554-53a8-42ad-b85e-ca6f6b86366c','9a6923d7-d492-4bb2-b9b2-323f438369b1')
)
DELETE FROM public.signals s
USING objetivo o
WHERE s.id = o.sig
  AND EXISTS (
    SELECT 1 FROM public.signals t
    WHERE t.company_id = o.destino
      AND t.id <> s.id
      AND t.contact_id  IS NOT DISTINCT FROM s.contact_id
      AND t.signal_type = s.signal_type
      AND t.signal_id   IS NOT DISTINCT FROM s.signal_id
  );

UPDATE public.signals SET company_id = '5adb6c73-98cb-42a6-939e-bdce3a09c534'
WHERE id = ANY(ARRAY[
  'fa9e34ab-cd43-4383-a702-11a0bf19b0b7','9b9ba694-e0eb-43b7-a840-71c76413a948',
  '76bd4019-c120-4a3a-9c79-d1852985dc4d','f49288ff-2650-4885-8032-398a0e68c3e3',
  '6057b0cf-c3d4-4dd3-8339-8194ff859db7','0c56d4a1-c529-4639-8e70-90a3b0406c95',
  '207feab7-13aa-451c-9e82-23a7c5a9a5d4','3198d8c4-21c4-4eee-83c0-7e1506b24623',
  '138b07cb-e27c-4740-96ca-a0cb2a1737a7']::uuid[]);

UPDATE public.signals SET company_id = '9a6923d7-d492-4bb2-b9b2-323f438369b1'
WHERE id = '7c5b0554-53a8-42ad-b85e-ca6f6b86366c';

DELETE FROM v3.company_merges
WHERE id IN ('cda21011-004e-488d-bb95-d07f784d63a6',  -- ALICO
             '50839ebc-134f-408b-aa88-d03e8d095a75'); -- Reyco

COMMIT;
