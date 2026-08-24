-- =============================================================================
-- 456 - normalized_name coherente con company_core_name en toda la tabla
-- =============================================================================
--
-- QUE QUEDABA MAL
--
-- El backfill del script 450 solo relleno los normalized_name que estaban en
-- NULL. Las filas que YA tenian un valor se dejaron como estaban, y ese valor
-- venia de public.normalize_company_name, la funcion vieja que el script 455
-- termino borrando por muerta.
--
-- Resultado: 10.080 filas cuyo normalized_name no era el que daria
-- company_core_name. Y no por diferencias cosmeticas, sino de criterio:
--
--     Grupo Arcor S.A.I.C.    guardado "grupo arcor s.a.i.c"   core "arcor"
--     Carlsberg Group         guardado "carlsberg"             core "carlsberg group"
--     The Coca Cola Company   guardado "the coca cola company"  core "coca cola company"
--     Holding Alimentos SA    guardado "holding alimentos"     core "alimentos"
--
-- Importa porque el paso 3 de upsert_company busca con
-- `normalized_name = company_core_name(p_name)`. Una fila cuyo nucleo guardado
-- no es el canonico es INVISIBLE para ese match: el ETL no la encuentra y crea
-- un duplicado al lado.
--
-- SOBRE LAS 1.712 QUE PASAN A NULL
--
-- Para 1.712 de esas filas company_core_name devuelve NULL, asi que el update
-- las deja sin nucleo. Se reviso una por una que fueran basura antes de
-- aceptarlo:
--
--     1.683   "Unknown Company <uuid>"   el placeholder de upsert_company
--        29   URLs pegadas como nombre   www.sedespierta.com.ar, https://...
--
-- Que queden en NULL es lo correcto, no una perdida: normalized_name es la
-- columna por la que filtra search_companies_by_name_filtered, y hoy esas filas
-- ensucian la busqueda (alguien buscando "company" se cruza con los
-- placeholders). Verificado despues del update: de las 54.667 empresas
-- elegibles para esa busqueda siguen visibles 54.651, el 99,97%; las 16
-- invisibles son las mismas de siempre.
--
-- EFECTO MEDIDO EN LA INGESTA
--
-- Con los nucleos corregidos, "Carlsberg Group SA" pasa a devolver la fila
-- existente de Carlsberg Group donde antes creaba una nueva.
--
-- Y la guarda sigue operando: "Grupo Eolo S.A." NO matchea, porque su nucleo
-- ("eolo") tiene menos de 8 caracteres y ninguna fila con ese nucleo tiene
-- identidad externa. Entra como fila nueva y lo decide la deteccion nocturna,
-- que deja registro y se puede revertir. Es la asimetria de siempre: un merge
-- se deshace, una atribucion equivocada de contactos no.
-- =============================================================================

-- Por lotes: son ~10.000 filas y company_core_name es un regex sobre cada una.
-- Repetir hasta que la verificacion de abajo de 0.
UPDATE public.companies c
SET normalized_name = public.company_core_name(c.name),
    updated_at      = now()
WHERE c.id IN (
  SELECT id FROM public.companies
  WHERE normalized_name IS DISTINCT FROM public.company_core_name(name)
  LIMIT 6000
);

-- Verificacion: tiene que dar 0.
SELECT count(*) AS incoherentes
FROM public.companies
WHERE normalized_name IS DISTINCT FROM public.company_core_name(name);
