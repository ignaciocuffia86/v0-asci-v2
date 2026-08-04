# Normalización de País HQ (public.companies.country_normalized)

## Resumen ejecutivo

- **Objetivo:** llenar `country_normalized` con código ISO 3166-1 alpha-2 (AR, CL, CO, MX, etc.)
- **Target:** 488.558 empresas (435.539 sin normalizar)
- **Cobertura esperada:**
  - Fases 1-3: ~12% (~50k empresas)
  - Con Fase 4 (LinkedIn): ~13-14% (~70-80k empresas, si hit rate ~80%)
- **Impacto de negocio:** elimina ambigüedad en filtros geográficos, habilita búsqueda reversa por país

## Datos clave

| Métrica | Valor |
|---------|-------|
| Total empresas | 488.558 |
| Con `country` | 53.941 |
| Sin `country` (vacío o NULL) | 434.617 |
| Con `website` | 51.246 |
| Con `linkedin_url` | 57.697 |
| Ya normalizadas (`country_normalized IS NOT NULL`) | 62.840 |

**Dato sorpresa:** 62.840 ya tienen `country_normalized` rellenado (de antes). El script solo modifica los 435.539 vacíos.

## Estrategia en 4 fases

### Fase 1: Limpieza y normalización de valores existentes
**Scope:** Empresas que YA tienen un valor en `country`

**Subcapas:**
- **1A. Mapeo:** valores → ISO alpha-2 (e.g., "Argentina" → "AR")
- **1B. Cleanup:** strings vacíos → NULL (para consistency con v2)

**Resultados esperados:**
- 1A: ~0 hits (los valores que hay son lugares específicos: "Greater Buenos Aires", "New York, NY", no países ISO)
- 1B: ~434k strings vacíos normalizados a NULL

**Criterio de corte:** Los datos existentes en `country` no son países limpiamente clasificables. Son direcciones de HQ. Preservar para auditoría; no forzar un mapeo que introduzca ruido.

### Fase 2: Parsing de nombres
**Scope:** Campo `name` de empresas sin país

**Método:** Busca sufijos geográficos
- "BBVA Argentina" → "Argentina" → "AR"
- "Samsung Chile" → "Chile" → "CL"
- "Telefónica España" → "España" → "ES"

**Regex usado:** nombres que terminan con ` Argentina`, ` Chile`, ` Mexico`, etc.

**Resultados esperados:** ~9.821 hits (~2% de cobertura)

**Limitación:** Solo sufijos exactos. "Empresa de Argentina" no matchea (es "in" Argentina, no suffijo). Pero es suficiente para nombres de filiales.

### Fase 3: Extracción por dominio TLD
**Scope:** Campo `website` de empresas sin país

**Método:** Parsea la extensión del dominio
- `.com.ar` → "AR"
- `.de` → "DE"
- `.fr` → "FR"

**Resultados esperados:** ~0 hits (muchos sitios usan .com/.net globales, no informativo)

**Limitación:** Solo aplica a TLDs **explícitamente nacionales**. No intenta "adivinar" desde .com o .org.

### Fase 5: IA + Heurística (Valores ambiguos)

**Estado:** Implementado en `lib/v3/services/country-normalizer.ts`  
**Scope:** ~500 valores sin ISO (ciudades, regiones: "Greater Buenos Aires", "New York, NY", "Santiago Metropolitan Area")

**Método:**
1. **Heurística pura:** regex de US states, diccionario de países, regiones LATAM
   - Cubre: "New York, NY" → "US", "Greater Buenos Aires" → "AR", "Lima" → "PE"
2. **Fallback a Gemini:** batch de 10 valores a la vez, prompt estructurado que devuelve JSON
   - Sistema prompt entiende que debe mapear ciudades/regiones a ISO
   - Hit rate esperado: 85-95%

**Cómo ejecutar (API job):**
```bash
# Desarrollo
curl -X POST http://localhost:3000/api/v3/admin/normalize-country-phase5 \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  -H "Content-Type: application/json"

# Producción: agregar a vercel.json (cron semanal)
{
  "crons": [{
    "path": "/api/v3/admin/normalize-country-phase5",
    "schedule": "0 2 * * 0"
  }]
}
```

**Resultados esperados:** 
- 400-500 valores ambiguos → ~85-95% mapeados a ISO
- Cobertura adicional: +1-2% (de 12% total a 13-14%)
- Empresas beneficiadas: ~5-10k adicionales

**Integración con v2:**
Una vez Fase 5 ejecutada, v2 puede usar `country_normalized` en lugar de `country` para filtros geográficos:

```sql
-- ANTES (v2): filtro contra valores sucio/ambiguo
WHERE (p_countries IS NULL OR c.country = ANY(p_countries))

-- DESPUÉS (v2 mejorado): filtro contra ISO normalizado
WHERE (p_countries IS NULL OR c.country_normalized = ANY(p_countries))
```

Esto permite que búsquedas como "qué empresas en Argentina" encuentren tanto "Argentina" como "Greater Buenos Aires", sin ambigüedad.

---

### Fase 4: Enrichment por LinkedIn (MANUAL)
**Scope:** 5.073 empresas con URL de LinkedIn pero sin país

**Método (Opción A - Apify actor):**
```bash
curl -X POST https://api.apify.com/v2/acts/linkedinProfileScraper/runs \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "profileUrls": [
      "https://www.linkedin.com/company/empresa-1/",
      ...
    ],
    "parseCompanyHQ": true
  }'
```

**Método (Opción B - Manual + Apollo):**
- Si tienes `apollo_organization_id` (existe en algunas empresas)
- Consultá Apollo API `/v1/companies` → `hq_address` → parsea país
- Ej: "Headquarters: 1 Microsoft Way, Redmond, WA" → "US"

**Hit rate esperado:** 80-90% (LinkedIn es bastante completo para HQ)

**Tiempo estimado:** 
- Opción A: ~1h (Apify batch + parseo de JSON)
- Opción B: ~2-3h (API calls + manual override para ambigüidades)

**Costo:** 
- Opción A: depende de credits de Apify (bajo: solo 5k URLs)
- Opción B: depende de tu cuota Apollo

---

## Implementación paso a paso

### 1. Dry-run (sin comprometer datos)
```bash
cd /vercel/share/v0-project
node scripts/run-sql.mjs --file scripts/430_normalize_country_hq.sql
```

Esto ejecuta todo sin escribir nada (rollback intencional al final). Podrás ver los NOTICE con los conteos exactos.

### 2. Validación de resultados
Si los NOTICE muestran números que tienen sentido (9.8k hits fase 2, ~5k LinkedIn), proceder.

### 3. Aplicar en producción (con COMMIT)
Descomentar la última línea del script (COMMIT) y ejecutar:
```bash
node scripts/run-sql.mjs --file scripts/430_normalize_country_hq.sql --commit
```

### 4. Fase 4 (opcional - LinkedIn)
**Opción A (recomendada - menor fricción):**
- Scrapear con Apify actor: `bebity/linkedin-scraper` o similar
- Parsear JSON response: buscar "Headquarters: City, Country"
- UPDATE batch en `country_normalized`

**Opción B (si tienes integración Apollo):**
- Consultar API → `hq_address` → regex para país
- UPDATE batch

**SQL para insertar Fase 4:**
```sql
-- Una vez que tengas las IDs → ISO mappings de LinkedIn
UPDATE public.companies
SET country_normalized = x.iso
FROM (
  VALUES
    ('empresa-id-1'::uuid, 'AR'),
    ('empresa-id-2'::uuid, 'CL'),
    ...
) AS x(id, iso)
WHERE public.companies.id = x.id
  AND public.companies.country_normalized IS NULL;
```

---

## Consideraciones de seguridad

- **No modifica `country`:** preserva datos originales (importante para auditoría de v2)
- **Solo escribe en `country_normalized`:** columna nueva, segregada
- **DRY RUN por defecto:** cambios requieren `--commit` explícito o UNCOMMENT final

---

## Qué esperar en resultados finales

### Distribución geográfica esperada (las 62.840 + 50k nuevas ~= 112.840 totales)
- Argentina: ~30%
- Brasil: ~20%
- México: ~15%
- Colombia: ~10%
- Otros LATAM: ~15%
- USA: ~5%
- Resto mundo: ~5%

(Estos números son estimados basados en el patrón de empresas en tu DB.)

### Problemas posibles y soluciones

| Problema | Causa | Solución |
|----------|-------|----------|
| "0 hits en todas las fases" | Script no corrió bien | Revisar NOTICE logs en stderr |
| "Muchos '(sin pais)' se quedan vacíos" | Fase 1 Mapeo no cubrió todo | Es esperado — los datos son muy sucio. Necesitaría diccionario más grande o Fase 4 |
| "Name parsing matcheó cosas raras" | Regex demasiado broad | Script está muy conservador; revisar ejemplos si desconfías |
| "LinkedIn paso no funciona" | Apify/Apollo no disponibles | Hacer manualmente o skip Fase 4 — los 12% base ya vale la pena |

---

## Integración con v2: Cómo mejorar los filtros geográficos

### El problema actual en v2

Las RPC `search_companies_by_technology_v2` y `search_companies_by_process_v2` filtran por:
```sql
WHERE (p_countries IS NULL OR c.country = ANY(p_countries))
```

Esto filtra contra `country` crudo, que tiene:
- "Argentina" (limpio)
- "Greater Buenos Aires" (ambiguo)
- "New York, NY" (estado de USA)
- "" (string vacío)
- NULL

**Problema:** Búsquedas por "Argentina" pierden las ~159 empresas con "Greater Buenos Aires". Similarmente, "US" pierde "New York, NY" (~64 empresas).

**Solución:** Una vez `country_normalized` esté lleno (Fases 1-5), cambiar el filtro a usar ISO estandarizado.

### Cambio en las RPC de v2 (2 opciones)

**Opción A: Modificar las RPC existentes IN-PLACE** (requiere retest de v2)

```sql
-- ANTES: lib/v3/services/value-proposition-recommender.ts + search_companies_by_technology_v2
WHERE (p_countries IS NULL OR c.country = ANY(p_countries))

-- DESPUÉS
WHERE (p_countries IS NULL OR c.country_normalized = ANY(p_countries))
```

**Ventajas:**
- Cambio mínimo (1 línea por RPC)
- Automático: todas las búsquedas v2 se benefician

**Desventajas:**
- Si `country_normalized` es NULL, la fila no matchea (¡quebra búsquedas!)
- Solución: usar COALESCE: `COALESCE(c.country_normalized, c.country) = ANY(p_countries)`

**Opción B: Crear RPC nuevas v3 que wrappeen a v2** (recomendado para produción en vivo)

```sql
-- RPC nueva: search_companies_by_technology_v3
-- Internamente usa country_normalized; si NULL, fallback a country
CREATE OR REPLACE FUNCTION public.search_companies_by_technology_v3(
  p_product_id uuid,
  p_countries text[] DEFAULT NULL,
  ...
) RETURNS TABLE(...) AS $$
BEGIN
  RETURN QUERY
  SELECT ... FROM public.companies c WHERE
    (p_countries IS NULL OR 
     COALESCE(c.country_normalized, c.country) = ANY(p_countries))
    AND ...;
END;
$$ LANGUAGE plpgsql;
```

**Ventajas:**
- v2 no cambia (cero riesgo de breaking changes)
- v3 usa normalizado + fallback; convive con v2
- Gradual adoption

**Desventajas:**
- Duplicación de lógica (2 RPC similares)
- Clientes deben cambiar a v3

### Impacto en cobertura de búsquedas

Ejemplo: "¿Qué bancos de Argentina tienen Dynamics 365?"

| Escenario | Hits sin normalización | Hits con normalización | Delta |
|-----------|------------------------|------------------------|-------|
| Antes Fase 5 | 53 | ~180 | +240% |
| Después Fase 5 (c/IA) | 53 | ~200 | +277% |

Los +180 adicionales vienen de:
- "Greater Buenos Aires" → "AR" (~159 empresas)
- Otras regiones LATAM mapeadas (~21)

### Recomendación

1. **Ejecutar Fases 1-3 ahora** (Script 430): baseline ~50k normalizadas
2. **Ejecutar Fase 5** cuando Gemini esté lista (~500 valores ambiguos adicionales)
3. **Opción A (simple, v2-breaking):** Cambiar filtro a `country_normalized` una vez esté 90%+ lleno
   - Timing: después de Fase 5
   - Comunicar a clientes: "Las búsquedas geográficas son más precisas"
4. **Opción B (gradual):** Crear v3 en paralelo, migrar clientes progresivamente
   - Timing: paralelo a Fase 5
   - Zero-downtime deployment

**Recomendación elegida:** Opción A (simple) + COALESCE fallback para máxima compatibilidad.

---

## Mantenimiento futuro

- Si los datos de `country` van a mejorar (limpieza manual), re-ejecutar Fase 1 periódicamente
- Si agregan nombres de empresas nuevas, podrían beneficiarse de Fase 2: correr contra nuevas filas sin `country_normalized`
- Si integran Apify como proceso automático: considerar ejecutar Fase 4 post-ingesta de empresas nuevas

---

## Referencias

- **ISO 3166-1 Alpha-2:** https://www.iso.org/iso-3166-country-codes.html
- **Formato en el código:** Ver `lib/v3/services/value-proposition-recommender.ts` → `COUNTRY_ALIASES` (patrón de 2 vías: nombre ↔ código)
- **Tabla original:** `public.companies` (v2)
- **Columna destino:** `country_normalized` (nueva, en v3 pero compartida por ambas versiones)
