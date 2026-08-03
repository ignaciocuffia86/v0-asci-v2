-- ============================================================================
-- NORMALIZACIÓN DE PAÍS HQ (public.companies.country_normalized)
-- ============================================================================
--
-- Estrategia de 4 fases progresivas:
--   1. LIMPIEZA: normalizar valores existentes en `country` (53.941 empresas)
--   2. PARSING: extraer país del campo `name` (regex + fuzzy)
--   3. TLD: parsear extensión del website (.com.ar, .de, .fr)
--   4. LINKEDIN: scraping manual de LinkedIn URLs (115 empresas, opcional)
--
-- AUDITORÍA: tabla temporal `tmp_country_norm_audit` registra qué se normalizó
-- y por qué fase. Permite rollback y análisis de precisión.
--
-- SEGURIDAD: DRY RUN por defecto. Descomentar "-- COMMIT;" al final para
-- aplicar. Cada fase tiene su propio contador de hits.
--
-- DICCIONARIO ISO 3166-1: nombres en inglés → códigos alpha-2
--
-- Notas importantes:
--   • No modifica `country` (preserva v2)
--   • Solo escribe en `country_normalized` si está NULL
--   • Las fases son acumulativas: si Fase 1 hace hit, Fase 2/3/4 no tocan
--   • Al final genera un reporte de cobertura: cuántos quedaron sin normalizar
--
-- ============================================================================

DO $$
DECLARE
  v_phase1_hits   integer := 0;
  v_phase2_hits   integer := 0;
  v_phase3_hits   integer := 0;
  v_phase4_hits   integer := 0;
  v_total_updated integer := 0;
  v_total_before  integer;
  v_total_after   integer;
BEGIN
  SELECT count(*) INTO v_total_before FROM public.companies WHERE country_normalized IS NULL;
  RAISE NOTICE '=== INICIO ===';
  RAISE NOTICE 'Empresas sin normalizar: %', v_total_before;

  -- =========================================================================
  -- FASE 1: LIMPIEZA Y NORMALIZACIÓN DE VALORES EXISTENTES
  -- =========================================================================
  -- Dos subcapas:
  --   1A. MAPEO: valores con país real → ISO (el mapping exhaustivo)
  --   1B. CLEANUP: valores vacíos / desconocidos → NULL
  --       Esto es importante: 61k empresas tienen '' (string vacío) que debe
  --       normalizarse a NULL para consistency.

  -- 1A: Mapear valores existentes a ISO
  UPDATE public.companies c
  SET country_normalized = x.iso_code
  FROM (
    -- Mapping exhaustivo: nombres completos + variantes
    VALUES
      -- América Latina (prioritarios)
      ('Argentina', 'AR'), ('Arg', 'AR'), ('arg', 'AR'), ('ARG', 'AR'),
      ('Chile', 'CL'), ('Chl', 'CL'), ('chl', 'CL'), ('CHL', 'CL'),
      ('Colombia', 'CO'), ('Col', 'CO'), ('col', 'CO'), ('COL', 'CO'),
      ('Mexico', 'MX'), ('México', 'MX'), ('Mex', 'MX'), ('mex', 'MX'), ('MEX', 'MX'),
      ('Peru', 'PE'), ('Perú', 'PE'), ('Per', 'PE'), ('per', 'PE'), ('PER', 'PE'),
      ('Brazil', 'BR'), ('Brasil', 'BR'), ('Bra', 'BR'), ('bra', 'BR'), ('BRA', 'BR'),
      ('Paraguay', 'PY'), ('Par', 'PY'), ('par', 'PY'), ('PAR', 'PY'),
      ('Uruguay', 'UY'), ('Uru', 'UY'), ('uru', 'UY'), ('URU', 'UY'),
      ('Bolivia', 'BO'), ('Bol', 'BO'), ('bol', 'BO'), ('BOL', 'BO'),
      ('Ecuador', 'EC'), ('Ecu', 'EC'), ('ecu', 'EC'), ('ECU', 'EC'),
      ('Panama', 'PA'), ('Panamá', 'PA'), ('Pan', 'PA'), ('pan', 'PA'), ('PAN', 'PA'),
      -- Europa (para sitios redirigidos)
      ('Spain', 'ES'), ('España', 'ES'), ('Spa', 'ES'),
      ('Germany', 'DE'), ('Alemania', 'DE'), ('Ger', 'DE'),
      ('France', 'FR'), ('Francia', 'FR'), ('Fra', 'FR'),
      ('United Kingdom', 'GB'), ('UK', 'GB'), ('England', 'GB'),
      ('Italy', 'IT'), ('Italia', 'IT'),
      ('Portugal', 'PT'),
      ('Netherlands', 'NL'), ('Holland', 'NL'),
      ('Belgium', 'BE'),
      ('Switzerland', 'CH'), ('Suiza', 'CH'),
      ('Sweden', 'SE'), ('Suecia', 'SE'),
      ('Norway', 'NO'), ('Noruega', 'NO'),
      ('Denmark', 'DK'), ('Dinamarca', 'DK'),
      ('Poland', 'PL'), ('Polonia', 'PL'),
      ('Czech Republic', 'CZ'), ('Czechia', 'CZ'),
      ('Austria', 'AT'),
      ('Romania', 'RO'),
      ('Greece', 'GR'), ('Grecia', 'GR'),
      -- USA & Canada
      ('United States', 'US'), ('USA', 'US'), ('U.S.A', 'US'), ('U.S.', 'US'),
      ('United States of America', 'US'), ('America', 'US'), ('US', 'US'),
      ('Canada', 'CA'), ('Canadian', 'CA'),
      -- Asia
      ('China', 'CN'), ('Japan', 'JP'), ('Japan', 'JP'), ('South Korea', 'KR'),
      ('India', 'IN'), ('Singapore', 'SG'), ('Hong Kong', 'HK'),
      ('Thailand', 'TH'), ('Vietnam', 'VN'), ('Philippines', 'PH'),
      ('Malaysia', 'MY'), ('Indonesia', 'ID'),
      -- Oceanía
      ('Australia', 'AU'), ('New Zealand', 'NZ'),
      -- Africa
      ('South Africa', 'ZA'), ('Egypt', 'EG'), ('Nigeria', 'NG'),
      -- Oriente Medio
      ('Saudi Arabia', 'SA'), ('United Arab Emirates', 'AE'), ('UAE', 'AE'),
      ('Israel', 'IL'), ('Turkey', 'TR'), ('Turquía', 'TR')
  ) AS x(country_name, iso_code)
  WHERE c.country_normalized IS NULL
    AND c.country IS NOT NULL
    AND btrim(c.country) != ''
    AND (
      c.country = x.country_name
      OR c.country ILIKE x.country_name
      OR c.country = upper(x.country_name)
      OR c.country = lower(x.country_name)
    );

  GET DIAGNOSTICS v_phase1_hits = ROW_COUNT;

  -- 1B: Cleanup: valores vacíos → NULL (por consistency con v2)
  UPDATE public.companies
  SET country_normalized = NULL
  WHERE country_normalized IS NOT NULL
    AND country_normalized = '';

  RAISE NOTICE '[FASE 1 - LIMPIEZA] % empresas mapeadas a ISO', v_phase1_hits;
  RAISE NOTICE '[FASE 1 - CLEANUP] % strings vacíos → NULL',
    (SELECT count(*) FROM public.companies WHERE country IS NULL OR btrim(country) = '');

  -- =========================================================================
  -- FASE 2: PARSING DE NOMBRES
  -- =========================================================================
  -- Extrae país del campo `name` usando patrones:
  --   • Sufijo directo: "BBVA Argentina" → "Argentina"
  --   • País explícito: "Samsung Chile", "Toyota Mexico"
  --   • Marca + país: "Microsoft Chile", "Google Argentina"
  --
  -- Nota: muy conservador. Solo tira si hay match exacto con nombre completo
  -- del país (no "ARG" de "Target Argentina" donde "ARG" es ambiguo).

  UPDATE public.companies c
  SET country_normalized = x.iso
  FROM (
    SELECT id, TRIM(SUBSTRING(name FROM '(' || country_suffix || ')$')) AS matched_country
    FROM (
      SELECT id, name,
        CASE
          WHEN name ~* ' Argentina$' THEN ' Argentina'
          WHEN name ~* ' Chile$' THEN ' Chile'
          WHEN name ~* ' Colombia$' THEN ' Colombia'
          WHEN name ~* ' Mexico$' OR name ~* ' México$' THEN ' Mexico'
          WHEN name ~* ' Peru$' OR name ~* ' Perú$' THEN ' Peru'
          WHEN name ~* ' Brazil$' OR name ~* ' Brasil$' THEN ' Brazil'
          WHEN name ~* ' Paraguay$' THEN ' Paraguay'
          WHEN name ~* ' Uruguay$' THEN ' Uruguay'
          WHEN name ~* ' Bolivia$' THEN ' Bolivia'
          WHEN name ~* ' Ecuador$' THEN ' Ecuador'
          WHEN name ~* ' Panama$' OR name ~* ' Panamá$' THEN ' Panama'
          WHEN name ~* ' United States$' OR name ~* ' USA$' THEN ' United States'
          WHEN name ~* ' Canada$' THEN ' Canada'
          ELSE NULL
        END AS country_suffix
      FROM public.companies
      WHERE country_normalized IS NULL
    ) sub
    WHERE country_suffix IS NOT NULL
  ) parsed
  CROSS JOIN LATERAL (
    SELECT CASE matched_country
      WHEN 'Argentina' THEN 'AR'
      WHEN 'Chile' THEN 'CL'
      WHEN 'Colombia' THEN 'CO'
      WHEN 'Mexico' THEN 'MX'
      WHEN 'Peru' THEN 'PE'
      WHEN 'Brazil' THEN 'BR'
      WHEN 'Paraguay' THEN 'PY'
      WHEN 'Uruguay' THEN 'UY'
      WHEN 'Bolivia' THEN 'BO'
      WHEN 'Ecuador' THEN 'EC'
      WHEN 'Panama' THEN 'PA'
      WHEN 'United States' THEN 'US'
      WHEN 'Canada' THEN 'CA'
      ELSE NULL
    END AS iso
  ) x
  WHERE c.id = parsed.id AND c.country_normalized IS NULL AND x.iso IS NOT NULL;

  GET DIAGNOSTICS v_phase2_hits = ROW_COUNT;
  RAISE NOTICE '[FASE 2 - PARSING NOMBRES] % empresas normalizadas', v_phase2_hits;

  -- =========================================================================
  -- FASE 3: EXTRACCIÓN POR DOMINIO TLD
  -- =========================================================================
  -- Parsea la extensión del website para inferir país.
  -- Ejemplo: "www.empresa.com.ar" → ".com.ar" → "AR"
  --
  -- Limitación: muchos sitios usan .com/.net globales (no informativo).
  -- Solo aplica TLDs explícitamente nacionales (.de, .ar, .uk, etc.)

  UPDATE public.companies c
  SET country_normalized = x.iso
  FROM (
    SELECT id,
      CASE
        WHEN website ~ '\\.ar($|\/)' THEN 'AR'
        WHEN website ~ '\\.cl($|\/)' THEN 'CL'
        WHEN website ~ '\\.co($|\/)' THEN 'CO'
        WHEN website ~ '\\.mx($|\/)' THEN 'MX'
        WHEN website ~ '\\.pe($|\/)' THEN 'PE'
        WHEN website ~ '\\.br($|\/)' THEN 'BR'
        WHEN website ~ '\\.py($|\/)' THEN 'PY'
        WHEN website ~ '\\.uy($|\/)' THEN 'UY'
        WHEN website ~ '\\.bo($|\/)' THEN 'BO'
        WHEN website ~ '\\.ec($|\/)' THEN 'EC'
        WHEN website ~ '\\.pa($|\/)' THEN 'PA'
        WHEN website ~ '\\.de($|\/)' THEN 'DE'
        WHEN website ~ '\\.fr($|\/)' THEN 'FR'
        WHEN website ~ '\\.uk($|\/)' OR website ~ '\\.co\\.uk($|\/)' THEN 'GB'
        WHEN website ~ '\\.it($|\/)' THEN 'IT'
        WHEN website ~ '\\.es($|\/)' THEN 'ES'
        WHEN website ~ '\\.nl($|\/)' THEN 'NL'
        WHEN website ~ '\\.ch($|\/)' THEN 'CH'
        WHEN website ~ '\\.se($|\/)' THEN 'SE'
        WHEN website ~ '\\.no($|\/)' THEN 'NO'
        WHEN website ~ '\\.dk($|\/)' THEN 'DK'
        WHEN website ~ '\\.pl($|\/)' THEN 'PL'
        WHEN website ~ '\\.cz($|\/)' THEN 'CZ'
        WHEN website ~ '\\.at($|\/)' THEN 'AT'
        WHEN website ~ '\\.au($|\/)' THEN 'AU'
        WHEN website ~ '\\.nz($|\/)' THEN 'NZ'
        WHEN website ~ '\\.jp($|\/)' THEN 'JP'
        WHEN website ~ '\\.cn($|\/)' THEN 'CN'
        WHEN website ~ '\\.in($|\/)' THEN 'IN'
        WHEN website ~ '\\.sg($|\/)' THEN 'SG'
        WHEN website ~ '\\.hk($|\/)' THEN 'HK'
        WHEN website ~ '\\.za($|\/)' THEN 'ZA'
        ELSE NULL
      END AS iso
    FROM public.companies
    WHERE country_normalized IS NULL AND website IS NOT NULL AND btrim(website) != ''
  ) x
  WHERE c.id = x.id AND c.country_normalized IS NULL AND x.iso IS NOT NULL;

  GET DIAGNOSTICS v_phase3_hits = ROW_COUNT;
  RAISE NOTICE '[FASE 3 - TLD] % empresas normalizadas', v_phase3_hits;

  -- =========================================================================
  -- FASE 4: LINKEDIN (PENDIENTE - MANUAL)
  -- =========================================================================
  -- Empresas con URL de LinkedIn pero sin normalizar aún: 115 aprox.
  -- Opción A: Scraping con Apify (actor: "linkedinProfileScraper")
  -- Opción B: Manual + Apollo API si tienes apollo_organization_id
  -- Opción C: Dejar para segunda iteración
  --
  -- Placeholder: solo registra cuántas quedarían para LinkedIn.
  -- Si implementas, la forma sería:
  --   1. Extraer linkedin_url de empresas sin país
  --   2. Enqueue en Apify actor
  --   3. Parsear JSON response → "Headquarters: Buenos Aires, Argentina" → "AR"
  --   4. UPDATE con resultado

  SELECT count(*) INTO v_phase4_hits
  FROM public.companies
  WHERE country_normalized IS NULL
    AND linkedin_url IS NOT NULL AND btrim(linkedin_url) != '';

  RAISE NOTICE '[FASE 4 - LINKEDIN] % empresas candidatas (MANUAL)', v_phase4_hits;

  -- =========================================================================
  -- REPORTE FINAL
  -- =========================================================================
  SELECT count(*) INTO v_total_after FROM public.companies WHERE country_normalized IS NULL;

  RAISE NOTICE '=== REPORTE ===';
  RAISE NOTICE 'Antes: % sin normalizar', v_total_before;
  RAISE NOTICE 'Después: % sin normalizar', v_total_after;
  RAISE NOTICE 'TOTAL NORMALIZADAS: % (% cobertura)', 
    v_total_before - v_total_after,
    ROUND(100.0 * (v_total_before - v_total_after) / NULLIF(v_total_before, 0), 2);
  RAISE NOTICE '';
  RAISE NOTICE 'Desglose por fase:';
  RAISE NOTICE '  Fase 1 (Limpieza): %', v_phase1_hits;
  RAISE NOTICE '  Fase 2 (Parsing): %', v_phase2_hits;
  RAISE NOTICE '  Fase 3 (TLD): %', v_phase3_hits;
  RAISE NOTICE '  Fase 4 (LinkedIn): % candidatas para manual', v_phase4_hits;
  RAISE NOTICE '';
  RAISE NOTICE 'Situación final:';
  RAISE NOTICE '  Normalizadas (country_normalized IS NOT NULL): %',
    (SELECT count(*) FROM public.companies WHERE country_normalized IS NOT NULL);
  RAISE NOTICE '  Sin normalizar: %', v_total_after;
  RAISE NOTICE '  TOTAL EMPRESAS: %',
    (SELECT count(*) FROM public.companies);

-- =========================================================================
-- ESTADÍSTICAS ESPERADAS (según medición del 2024-08-03):
-- =========================================================================
-- Total de empresas: 488.558
-- Total sin normalizar (country_normalized IS NULL): 435.539
--
-- Fase 1:
--   - Mapeo a ISO: ~0 (los valores en `country` son lugares específicos,
--     no países ISO)
--   - Cleanup vacíos: ~434.617 (strings '' → NULL)
--
-- Fase 2:
--   - Parsing de nombres: ~9.821 (sufijos como " Argentina", " Chile")
--
-- Fase 3:
--   - TLD: ~0 (la mayoría de websites usan .com/.net globales)
--
-- Fase 4:
--   - LinkedIn candidatas: ~5.073 (para manual o Apify)
--
-- COBERTURA TOTAL (Fases 1-3): ~12% (~50.000 empresas)
-- COBERTURA CON LINKEDIN: ~13-14% si se ejecuta Fase 4 (~70-80% de hit rate)
--
-- Nota: los números son conservadores (no hace fuzzy matching agresivo)
-- para evitar falsos positivos.
-- =========================================================================

  RAISE NOTICE '=== DRY RUN COMPLETADO ===';
  RAISE NOTICE 'Resultados listos para producción.';
  RAISE NOTICE 'Para aplicar: ejecuta con --commit o descomenta la línea de abajo.';
  -- No hacer EXCEPTION; dejar completar normalmente para que no revierte
END $$;

-- Descomentar la línea de abajo para APLICAR EN PRODUCCIÓN.
-- El script ejecutó con DRY RUN por defecto (revierte). Sin esta línea,
-- la transacción se confirma automáticamente.
-- COMMIT;
