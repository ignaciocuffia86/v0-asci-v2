import { conConexionDirecta } from "@/lib/db/direct"

async function runDiagnostic() {
  try {
    console.log('📊 DIAGNÓSTICO DE NORMALIZACIÓN DE PAÍSES\n');

    await conConexionDirecta(async (client) => {
      // 1. Verificar columnas de compañías
      console.log('=== 1. ESTRUCTURA DE TABLA ===\n');
      
      const columnsRes = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'companies'
        ORDER BY ordinal_position;
      `);
      
      console.log(`Total de columnas: ${columnsRes.rows.length}`);
      const relevantColumns = columnsRes.rows.filter((row: any) => 
        ['country', 'name', 'website', 'linkedin_url', 'apollo_employees_count', 'description', 'industry'].includes(row.column_name)
      );
      
      console.log('Columnas relevantes:');
      relevantColumns.forEach((row: any) => {
        console.log(`  - ${row.column_name} (${row.data_type}${row.is_nullable === 'YES' ? ', nullable' : ''})`);
      });

      // 2. Estadísticas generales
      console.log('\n=== 2. ESTADÍSTICAS GENERALES ===\n');
      
      const statsRes = await client.query(`
        SELECT 
          COUNT(*) as total_compañias,
          COUNT(CASE WHEN country IS NULL THEN 1 END) as sin_pais,
          COUNT(CASE WHEN country IS NOT NULL THEN 1 END) as con_pais,
          COUNT(DISTINCT country) as paises_distintos,
          ROUND(100.0 * COUNT(CASE WHEN country IS NULL THEN 1 END) / COUNT(*), 1) as porcentaje_sin_pais
        FROM public.companies;
      `);
      
      const stats = statsRes.rows[0] as any;
      console.log(`Total de compañías: ${stats.total_compañias}`);
      console.log(`Con país: ${stats.con_pais} (${100 - stats.porcentaje_sin_pais}%)`);
      console.log(`SIN país: ${stats.sin_pais} (${stats.porcentaje_sin_pais}%)`);
      console.log(`Países distintos: ${stats.paises_distintos}`);

      // 3. Datos de apollo_employees_count
      console.log('\n=== 3. COBERTURA DE apollo_employees_count ===\n');
      
      const empRes = await client.query(`
        SELECT 
          COUNT(*) as total_sin_pais,
          COUNT(CASE WHEN apollo_employees_count IS NOT NULL THEN 1 END) as con_empleados,
          ROUND(100.0 * COUNT(CASE WHEN apollo_employees_count IS NOT NULL THEN 1 END) / COUNT(*), 1) as porcentaje,
          MIN(apollo_employees_count) as min_empleados,
          MAX(apollo_employees_count) as max_empleados,
          ROUND(AVG(apollo_employees_count)::numeric, 0) as promedio
        FROM public.companies
        WHERE country IS NULL;
      `);
      
      const emp = empRes.rows[0] as any;
      console.log(`Compañías SIN país con apollo_employees_count: ${emp.con_empleados} / ${emp.total_sin_pais} (${emp.porcentaje}%)`);
      if (emp.con_empleados > 0) {
        console.log(`Rango de empleados: ${emp.min_empleados} - ${emp.max_empleados}`);
        console.log(`Promedio: ${emp.promedio}`);
      }

      // 4. Oportunidades de enriquecimiento
      console.log('\n=== 4. OPORTUNIDADES DE ENRIQUECIMIENTO ===\n');
      
      const oppRes = await client.query(`
        SELECT 
          COUNT(*) as total_sin_pais,
          COUNT(CASE WHEN website IS NOT NULL THEN 1 END) as con_website,
          COUNT(CASE WHEN linkedin_url IS NOT NULL THEN 1 END) as con_linkedin,
          COUNT(CASE WHEN description IS NOT NULL THEN 1 END) as con_descripcion,
          COUNT(CASE WHEN name NOT ILIKE '%Unknown%' THEN 1 END) as nombres_validos,
          COUNT(CASE WHEN industry IS NOT NULL THEN 1 END) as con_industria,
          COUNT(CASE WHEN apollo_employees_count IS NOT NULL THEN 1 END) as con_empleados
        FROM public.companies
        WHERE country IS NULL;
      `);
      
      const opp = oppRes.rows[0] as any;
      const total = opp.total_sin_pais;
      console.log(`Total sin país: ${total}\n`);
      console.log(`Con website: ${opp.con_website} (${Math.round(100*opp.con_website/total)}%)`);
      console.log(`Con LinkedIn: ${opp.con_linkedin} (${Math.round(100*opp.con_linkedin/total)}%)`);
      console.log(`Con descripción: ${opp.con_descripcion} (${Math.round(100*opp.con_descripcion/total)}%)`);
      console.log(`Con industria: ${opp.con_industria} (${Math.round(100*opp.con_industria/total)}%)`);
      console.log(`Nombres válidos (≠ Unknown): ${opp.nombres_validos} (${Math.round(100*opp.nombres_validos/total)}%)`);
      console.log(`Con apollo_employees_count: ${opp.con_empleados} (${Math.round(100*opp.con_empleados/total)}%)`);

      // 5. Análisis de NOMBRES (patrones de país)
      console.log('\n=== 5. PATRONES EN NOMBRES (país extraíble) ===\n');
      
      const nameRes = await client.query(`
        WITH detected AS (
          SELECT 
            CASE
              WHEN name ~* '\\b(Argentina|Argentine)\\b' THEN 'Argentina'
              WHEN name ~* '\\b(Brazil|Brazilian)\\b' THEN 'Brazil'
              WHEN name ~* '\\b(Mexico|Mexican)\\b' THEN 'Mexico'
              WHEN name ~* '\\b(Chile|Chilean)\\b' THEN 'Chile'
              WHEN name ~* '\\b(Colombia|Colombian)\\b' THEN 'Colombia'
              WHEN name ~* '\\b(Peru|Peruvian)\\b' THEN 'Peru'
              WHEN name ~* '\\b(Spain|Spanish|España)\\b' THEN 'Spain'
              WHEN name ~* '\\b(Germany|German|Alemania)\\b' THEN 'Germany'
              WHEN name ~* '\\b(France|French|Francia)\\b' THEN 'France'
              WHEN name ~* '\\b(United Kingdom|UK|British|England)\\b' THEN 'United Kingdom'
              WHEN name ~* '\\b(Japan|Japanese|Japón)\\b' THEN 'Japan'
              WHEN name ~* '\\b(China|Chinese)\\b' THEN 'China'
              WHEN name ~* '\\b(Singapore|Singaporean)\\b' THEN 'Singapore'
              WHEN name ~* '\\b(United States|USA|US|American)\\b' THEN 'United States'
              ELSE NULL
            END as country_name
          FROM public.companies
          WHERE country IS NULL AND website IS NOT NULL
        )
        SELECT country_name, COUNT(*) as qty
        FROM detected
        WHERE country_name IS NOT NULL
        GROUP BY country_name
        ORDER BY qty DESC;
      `);
      
      console.log(`Compañías detectables por nombre: ${nameRes.rows.reduce((sum: number, row: any) => sum + row.qty, 0)}`);
      nameRes.rows.forEach((row: any) => {
        console.log(`  ${row.country_name}: ${row.qty}`);
      });

      // 6. Análisis de DOMINIOS (TLD)
      console.log('\n=== 6. PATRONES EN DOMINIOS (TLD → país) ===\n');
      
      const domainRes = await client.query(`
        WITH detected AS (
          SELECT 
            CASE
              WHEN website ILIKE '%.com.ar' THEN 'Argentina (.com.ar)'
              WHEN website ILIKE '%.com.br' THEN 'Brazil (.com.br)'
              WHEN website ILIKE '%.com.mx' THEN 'Mexico (.com.mx)'
              WHEN website ILIKE '%.com.co' THEN 'Colombia (.com.co)'
              WHEN website ILIKE '%.com.cl' THEN 'Chile (.com.cl)'
              WHEN website ILIKE '%.com.pe' THEN 'Peru (.com.pe)'
              WHEN website ILIKE '%.com.uy' THEN 'Uruguay (.com.uy)'
              WHEN website ILIKE '%.co.uk' THEN 'United Kingdom (.co.uk)'
              WHEN website ILIKE '%.de' THEN 'Germany (.de)'
              WHEN website ILIKE '%.es' THEN 'Spain (.es)'
              WHEN website ILIKE '%.fr' THEN 'France (.fr)'
              WHEN website ILIKE '%.it' THEN 'Italy (.it)'
              WHEN website ILIKE '%.nl' THEN 'Netherlands (.nl)'
              WHEN website ILIKE '%.ch' THEN 'Switzerland (.ch)'
              WHEN website ILIKE '%.se' THEN 'Sweden (.se)'
              WHEN website ILIKE '%.jp' THEN 'Japan (.jp)'
              WHEN website ILIKE '%.in' THEN 'India (.in)'
              WHEN website ILIKE '%.au' THEN 'Australia (.au)'
              ELSE NULL
            END as country_tld
          FROM public.companies
          WHERE country IS NULL AND website IS NOT NULL
        )
        SELECT country_tld, COUNT(*) as qty
        FROM detected
        WHERE country_tld IS NOT NULL
        GROUP BY country_tld
        ORDER BY qty DESC;
      `);
      
      console.log(`Compañías detectables por dominio: ${domainRes.rows.reduce((sum: number, row: any) => sum + row.qty, 0)}`);
      domainRes.rows.forEach((row: any) => {
        console.log(`  ${row.country_tld}: ${row.qty}`);
      });

      // 7. Estado de normalización actual (países existentes)
      console.log('\n=== 7. ESTADO DE NORMALIZACIÓN (países ya en tabla) ===\n');
      
      const normRes = await client.query(`
        SELECT 
          country,
          COUNT(*) as cantidad
        FROM public.companies
        WHERE country IS NOT NULL
        GROUP BY country
        ORDER BY cantidad DESC
        LIMIT 25;
      `);
      
      console.log(`Formatos de país encontrados (top 25):`);
      normRes.rows.forEach((row: any, i: number) => {
        if (i < 10) {
          console.log(`  "${row.country}": ${row.cantidad}`);
        }
      });
      if (normRes.rows.length > 10) {
        console.log(`  ... (${normRes.rows.length - 10} más)`);
      }

      // 8. Muestreo de compañías sin país
      console.log('\n=== 8. MUESTREO DE COMPAÑÍAS SIN PAÍS ===\n');
      
      const sampleRes = await client.query(`
        SELECT 
          id,
          name,
          website,
          linkedin_url,
          industry,
          apollo_employees_count
        FROM public.companies
        WHERE country IS NULL 
          AND name NOT ILIKE '%Unknown%'
          AND (website IS NOT NULL OR linkedin_url IS NOT NULL)
        ORDER BY created_at DESC
        LIMIT 20;
      `);
      
      console.log(`Primeras 20 compañías válidas sin país:\n`);
      sampleRes.rows.forEach((row: any, i: number) => {
        console.log(`${i + 1}. ${row.name}`);
        console.log(`   Website: ${row.website || 'N/A'}`);
        console.log(`   LinkedIn: ${row.linkedin_url ? '✓' : 'N/A'}`);
        console.log(`   Industria: ${row.industry || 'N/A'}`);
        console.log(`   Empleados: ${row.apollo_employees_count || 'N/A'}`);
        console.log('');
      });

      console.log('✅ Diagnóstico completado\n');
    })
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

runDiagnostic();
