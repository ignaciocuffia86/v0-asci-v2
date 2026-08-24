-- Auditoría del diccionario de tecnologías
-- Consultas de diagnóstico usadas para docs/auditoria-diccionario-tecnologia.md
-- Solo lectura salvo el bloque final, que está comentado a propósito.
--
-- El motor matchea con: '\y' || escape_regex(keyword) || '\y'  contra  ~*  (ver process_dictionary_job).
-- Todo lo que sigue busca las tres formas en que ese patrón falla.

-- ---------------------------------------------------------------------------
-- 1. Keywords repetidas en más de un producto (una persona genera N señales)
-- ---------------------------------------------------------------------------
WITH kw AS (
  SELECT p.id, v.name AS vendor, p.name AS product, lower(trim(k.kw)) AS kw
  FROM dictionary_products p
  LEFT JOIN dictionary_vendors v ON v.id = p.vendor_id
  CROSS JOIN LATERAL unnest(p.keywords) AS k(kw)
)
SELECT kw,
       count(DISTINCT id) AS productos,
       string_agg(DISTINCT vendor || ' / ' || product, ' ;; ' ORDER BY vendor || ' / ' || product) AS donde
FROM kw
GROUP BY kw
HAVING count(DISTINCT id) > 1
ORDER BY count(DISTINCT id) DESC, kw;

-- ---------------------------------------------------------------------------
-- 2. Keywords repetidas dentro del mismo producto (duplicado literal en el array)
-- ---------------------------------------------------------------------------
WITH kw AS (
  SELECT p.id, p.name AS product, lower(trim(k.kw)) AS kw
  FROM dictionary_products p CROSS JOIN LATERAL unnest(p.keywords) AS k(kw)
)
SELECT product, kw, count(*) AS veces
FROM kw GROUP BY product, kw HAVING count(*) > 1 ORDER BY product, kw;

-- ---------------------------------------------------------------------------
-- 3. Keywords que NUNCA pueden matchear
--    '\y' exige transición palabra <-> no-palabra. Si la keyword empieza o
--    termina en un símbolo, esa transición no existe y el patrón nunca da true.
--    Ejemplos reales: 'C#', '.NET Core', '@Component', 'Accounts Payable (AP)'.
-- ---------------------------------------------------------------------------
SELECT v.name AS vendor, p.name AS product, k.kw
FROM dictionary_products p
LEFT JOIN dictionary_vendors v ON v.id = p.vendor_id
CROSS JOIN LATERAL unnest(p.keywords) AS k(kw)
WHERE k.kw !~ '^\w' OR k.kw !~ '\w$'
ORDER BY v.name, p.name, k.kw;

-- Verificación puntual del comportamiento del motor sobre texto real:
SELECT kw, txt, txt ~* ('\y' || public.escape_regex(kw) || '\y') AS matchea
FROM (VALUES
  ('C#',        'Desarrollador C# senior'),          -- false: el '#' rompe el \y
  ('.NET Core', 'Experiencia en .NET Core 8'),       -- false: el '.' inicial rompe el \y
  ('PAN',       'analista en Pan American Energy'),  -- true : falso positivo
  ('Defender',  'exponer y defender la propuesta'),  -- true : verbo en español
  ('SITs',      'she sits on the board')             -- true : palabra común en inglés
) AS t(kw, txt);

-- ---------------------------------------------------------------------------
-- 4. Volumen y dispersión por keyword: candidatos a falso positivo
--    Una keyword de una sola palabra con miles de señales suele ser genérica.
-- ---------------------------------------------------------------------------
SELECT v.name AS vendor, p.name AS product, s.keyword_matched,
       count(*) AS senales, count(DISTINCT s.company_id) AS cuentas,
       (array_agg(left(s.snippet, 120) ORDER BY random()))[1:3] AS muestra
FROM signals s
JOIN dictionary_products p ON p.id = s.signal_id
LEFT JOIN dictionary_vendors v ON v.id = p.vendor_id
WHERE s.signal_type = 'technology'
  AND s.keyword_matched !~ '\s'          -- una sola palabra
GROUP BY 1, 2, 3
HAVING count(*) >= 50
ORDER BY count(*) DESC;

-- ---------------------------------------------------------------------------
-- 5. Señales huérfanas: la keyword ya no está en el diccionario pero la señal sigue viva
-- ---------------------------------------------------------------------------
SELECT v.name AS vendor, p.name AS product, s.keyword_matched, count(*) AS senales
FROM signals s
JOIN dictionary_products p ON p.id = s.signal_id
LEFT JOIN dictionary_vendors v ON v.id = p.vendor_id
WHERE s.signal_type = 'technology'
  AND NOT EXISTS (
    SELECT 1 FROM unnest(p.keywords) k WHERE lower(k) = lower(s.keyword_matched)
  )
GROUP BY 1, 2, 3
ORDER BY count(*) DESC;

-- Limpieza (NO correr desde el browser: encolar como job y borrar en lotes,
-- ver docs/etl-diccionario-mejores-practicas.md, punto 4).
-- DELETE FROM signals s
-- USING dictionary_products p
-- WHERE s.signal_id = p.id
--   AND s.signal_type = 'technology'
--   AND NOT EXISTS (
--     SELECT 1 FROM unnest(p.keywords) k WHERE lower(k) = lower(s.keyword_matched)
--   );
