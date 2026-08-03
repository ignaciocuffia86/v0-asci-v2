import { rpcDirecto } from "@/lib/db/direct"

// ISO 3166 country codes y aliases comunes
const countryMap: Record<string, string> = {
  'AR': 'Argentina', 'AT': 'Austria', 'AU': 'Australia', 'BE': 'Belgium', 'BR': 'Brazil',
  'CA': 'Canada', 'CH': 'Switzerland', 'CL': 'Chile', 'CN': 'China', 'CO': 'Colombia',
  'DE': 'Germany', 'DK': 'Denmark', 'ES': 'Spain', 'FI': 'Finland', 'FR': 'France',
  'GB': 'United Kingdom', 'HK': 'Hong Kong', 'IE': 'Ireland', 'IN': 'India', 'IT': 'Italy',
  'JP': 'Japan', 'MX': 'Mexico', 'NL': 'Netherlands', 'NO': 'Norway', 'NZ': 'New Zealand',
  'PE': 'Peru', 'PL': 'Poland', 'PT': 'Portugal', 'RU': 'Russia', 'SE': 'Sweden',
  'SG': 'Singapore', 'US': 'United States', 'UY': 'Uruguay', 'VE': 'Venezuela', 'ZA': 'South Africa'
};

// Domain TLDs a países
const domainCountryMap: Record<string, string> = {
  '.com.ar': 'Argentina', '.com.br': 'Brazil', '.com.mx': 'Mexico', '.com.co': 'Colombia',
  '.com.cl': 'Chile', '.com.pe': 'Peru', '.com.uy': 'Uruguay', '.co.uk': 'United Kingdom',
  '.de': 'Germany', '.es': 'Spain', '.fr': 'France', '.it': 'Italy', '.nl': 'Netherlands',
  '.be': 'Belgium', '.ch': 'Switzerland', '.at': 'Austria', '.se': 'Sweden', '.no': 'Norway',
  '.dk': 'Denmark', '.fi': 'Finland', '.pl': 'Poland', '.ie': 'Ireland', '.pt': 'Portugal',
  '.jp': 'Japan', '.cn': 'China', '.hk': 'Hong Kong', '.in': 'India', '.sg': 'Singapore',
  '.au': 'Australia', '.nz': 'New Zealand', '.za': 'South Africa', '.ru': 'Russia',
  '.com': 'United States', '.net': 'United States', '.org': 'United States'
};

async function runDiagnostic() {
  try {
    console.log('=== 1. CAMPO apollo_employees_count ===\n');
    
    // Verificar si existe apollo_employees_count
    const columnsRes = await rpcDirecto(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'companies'
        AND column_name ILIKE '%employee%'
      ORDER BY column_name;
    `);
    
    console.log('Columnas con "employee" en la tabla companies:');
    if (columnsRes.length === 0) {
      console.log('❌ NO EXISTE campo apollo_employees_count');
    } else {
      (columnsRes as any[]).forEach(row => {
        console.log(`  - ${row.column_name} (${row.data_type})`);
      });
    }

    // Contar compañías con datos de empleados
    console.log('\nEntre compañías SIN PAÍS:');
    const empCountRes = await rpcDirecto(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN apollo_employees_count IS NOT NULL THEN 1 END) as con_empleados,
        COUNT(CASE WHEN apollo_employees_count IS NULL THEN 1 END) as sin_empleados,
        ROUND(100.0 * COUNT(CASE WHEN apollo_employees_count IS NOT NULL THEN 1 END) / NULLIF(COUNT(*), 0), 1) as porcentaje
      FROM public.companies
      WHERE country IS NULL;
    `) as any[];
    
    if (empCountRes.length > 0) {
      const empData = empCountRes[0];
      console.log(`  - Total: ${empData.total}`);
      console.log(`  - Con apollo_employees_count: ${empData.con_empleados} (${empData.porcentaje}%)`);
      console.log(`  - Sin apollo_employees_count: ${empData.sin_empleados}`);
    }

    // Análisis de NOMBRES
    console.log('\n=== 2. EXTRACCIÓN POR NOMBRE ===\n');
    
    const countryPatterns = [
      { pattern: '\\b(Argentina|Argentine)\\b', country: 'Argentina' },
      { pattern: '\\b(Brazil|Brazilian)\\b', country: 'Brazil' },
      { pattern: '\\b(Mexico|Mexican)\\b', country: 'Mexico' },
      { pattern: '\\b(Chile|Chilean)\\b', country: 'Chile' },
      { pattern: '\\b(Colombia|Colombian)\\b', country: 'Colombia' },
      { pattern: '\\b(Peru|Peruvian)\\b', country: 'Peru' },
      { pattern: '\\b(Spain|Spanish|España)\\b', country: 'Spain' },
      { pattern: '\\b(Germany|German|Alemania)\\b', country: 'Germany' },
      { pattern: '\\b(France|French|Francia)\\b', country: 'France' },
      { pattern: '\\b(United Kingdom|UK|British|England)\\b', country: 'United Kingdom' },
      { pattern: '\\b(Japan|Japanese|Japón)\\b', country: 'Japan' },
      { pattern: '\\b(China|Chinese)\\b', country: 'China' },
      { pattern: '\\b(Singapore|Singaporean)\\b', country: 'Singapore' },
      { pattern: '\\b(United States|USA|US|American)\\b', country: 'United States' }
    ];

    for (const {pattern, country} of countryPatterns) {
      const res = await rpcDirecto(
        `SELECT COUNT(*) as qty FROM public.companies 
         WHERE country IS NULL AND name ~* $1 AND website IS NOT NULL`,
        [pattern]
      ) as any[];
      if (res.length > 0 && res[0].qty > 0) {
        console.log(`  ${country}: ${res[0].qty} compañías`);
      }
    }

    // Análisis de DOMINIOS
    console.log('\n=== 3. EXTRACCIÓN POR DOMINIO ===\n');
    
    const tldPatterns = [
      '.com.ar', '.com.br', '.com.mx', '.com.co', '.com.cl', '.com.pe', '.com.uy',
      '.co.uk', '.de', '.es', '.fr', '.it', '.nl', '.ch', '.se', '.jp', '.in', '.au'
    ];

    for (const tld of tldPatterns) {
      const res = await rpcDirecto(
        `SELECT COUNT(*) as qty FROM public.companies 
         WHERE country IS NULL AND website ILIKE $1 AND website IS NOT NULL`,
        [`%${tld}`]
      ) as any[];
      if (res.length > 0 && res[0].qty > 0) {
        console.log(`  ${tld} → ${domainCountryMap[tld]}: ${res[0].qty} compañías`);
      }
    }

    // Resumen de oportunidades
    console.log('\n=== 4. RESUMEN DE OPORTUNIDADES DE ENRIQUECIMIENTO ===\n');
    
    const opportunitiesRes = await rpcDirecto(`
      SELECT 
        COUNT(*) as total_sin_pais,
        COUNT(CASE WHEN website IS NOT NULL THEN 1 END) as con_website,
        COUNT(CASE WHEN linkedin_url IS NOT NULL THEN 1 END) as con_linkedin,
        COUNT(CASE WHEN description IS NOT NULL THEN 1 END) as con_descripcion,
        COUNT(CASE WHEN name NOT ILIKE '%Unknown%' THEN 1 END) as nombres_validos
      FROM public.companies
      WHERE country IS NULL;
    `) as any[];

    if (opportunitiesRes.length > 0) {
      const opp = opportunitiesRes[0];
      const total = opp.total_sin_pais;
      console.log(`  Total sin país: ${total}`);
      console.log(`  Con website: ${opp.con_website} (${Math.round(100*opp.con_website/total)}%)`);
      console.log(`  Con LinkedIn: ${opp.con_linkedin} (${Math.round(100*opp.con_linkedin/total)}%)`);
      console.log(`  Con descripción: ${opp.con_descripcion} (${Math.round(100*opp.con_descripcion/total)}%)`);
      console.log(`  Nombres válidos (no 'Unknown'): ${opp.nombres_validos} (${Math.round(100*opp.nombres_validos/total)}%)`);
    }

    // Estado de normalización actual
    console.log('\n=== 5. ESTADO DE NORMALIZACIÓN ACTUAL (países existentes) ===\n');
    
    const normRes = await rpcDirecto(`
      SELECT 
        country,
        COUNT(*) as cantidad
      FROM public.companies
      WHERE country IS NOT NULL
      GROUP BY country
      ORDER BY cantidad DESC
      LIMIT 25;
    `) as any[];

    console.log('Formatos actuales de país:');
    normRes.forEach(row => {
      console.log(`  "${row.country}": ${row.cantidad}`);
    });

    console.log('\n✅ Diagnóstico completado\n');

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  }
}

runDiagnostic();
