import pkg from 'pg';
const { Client } = pkg;

// ISO 3166 country codes y aliases comunes
const countryMap = {
  'AR': 'Argentina', 'AT': 'Austria', 'AU': 'Australia', 'BE': 'Belgium', 'BR': 'Brazil',
  'CA': 'Canada', 'CH': 'Switzerland', 'CL': 'Chile', 'CN': 'China', 'CO': 'Colombia',
  'DE': 'Germany', 'DK': 'Denmark', 'ES': 'Spain', 'FI': 'Finland', 'FR': 'France',
  'GB': 'United Kingdom', 'HK': 'Hong Kong', 'IE': 'Ireland', 'IN': 'India', 'IT': 'Italy',
  'JP': 'Japan', 'MX': 'Mexico', 'NL': 'Netherlands', 'NO': 'Norway', 'NZ': 'New Zealand',
  'PE': 'Peru', 'PL': 'Poland', 'PT': 'Portugal', 'RU': 'Russia', 'SE': 'Sweden',
  'SG': 'Singapore', 'US': 'United States', 'UY': 'Uruguay', 'VE': 'Venezuela', 'ZA': 'South Africa'
};

// Domain TLDs a países
const domainCountryMap = {
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
  const client = new Client({
    host: process.env.POSTGRES_HOST,
    port: 5432,
    database: process.env.POSTGRES_DATABASE,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    ssl: true
  });

  try {
    await client.connect();
    console.log('✅ Conectado a PostgreSQL\n');

    // 1. Verificar si existe apollo_employees_count
    console.log('=== 1. CAMPO apollo_employees_count ===');
    const columnsRes = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'companies'
        AND column_name ILIKE '%employee%'
      ORDER BY column_name;
    `);
    
    console.log(`Columnas con "employee" en la tabla companies:`);
    if (columnsRes.rows.length === 0) {
      console.log('❌ NO EXISTE campo apollo_employees_count');
    } else {
      columnsRes.rows.forEach(row => {
        console.log(`  - ${row.column_name} (${row.data_type})`);
      });
    }

    // 2. Contar compañías con datos de empleados
    const empCountRes = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN apollo_employees_count IS NOT NULL THEN 1 END) as con_empleados,
        COUNT(CASE WHEN apollo_employees_count IS NULL THEN 1 END) as sin_empleados,
        ROUND(100.0 * COUNT(CASE WHEN apollo_employees_count IS NOT NULL THEN 1 END) / COUNT(*), 1) as porcentaje
      FROM public.companies
      WHERE country IS NULL;
    `);
    
    const empData = empCountRes.rows[0];
    console.log(`\n  Entre compañías SIN PAÍS:`);
    console.log(`  - Total: ${empData.total}`);
    console.log(`  - Con apollo_employees_count: ${empData.con_empleados} (${empData.porcentaje}%)`);
    console.log(`  - Sin apollo_employees_count: ${empData.sin_empleados}`);

    // 3. Análisis de NOMBRES (países extraíbles)
    console.log('\n=== 2. EXTRACCIÓN POR NOMBRE ===');
    
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
      { pattern: '\\b(China|Chinese|Singapur)\\b', country: 'China' },
      { pattern: '\\b(Singapore|Singaporean)\\b', country: 'Singapore' },
      { pattern: '\\b(United States|USA|US|American)\\b', country: 'United States' }
    ];

    for (const {pattern, country} of countryPatterns) {
      const res = await client.query(
        `SELECT COUNT(*) as qty FROM public.companies 
         WHERE country IS NULL AND name ~* $1 AND website IS NOT NULL`,
        [pattern]
      );
      if (res.rows[0].qty > 0) {
        console.log(`  ${country}: ${res.rows[0].qty} compañías`);
      }
    }

    // 4. Análisis de DOMINIOS (TLDs)
    console.log('\n=== 3. EXTRACCIÓN POR DOMINIO ===');
    
    const tldPatterns = [
      '.com.ar', '.com.br', '.com.mx', '.com.co', '.com.cl', '.com.pe', '.com.uy',
      '.co.uk', '.de', '.es', '.fr', '.it', '.nl', '.ch', '.se', '.jp', '.in', '.au'
    ];

    for (const tld of tldPatterns) {
      const res = await client.query(
        `SELECT COUNT(*) as qty FROM public.companies 
         WHERE country IS NULL AND website LIKE $1 AND website IS NOT NULL`,
        [`%${tld}`]
      );
      if (res.rows[0].qty > 0) {
        console.log(`  ${tld} → ${domainCountryMap[tld]}: ${res.rows[0].qty} compañías`);
      }
    }

    // 5. Análisis de CONTACTOS POR PAÍS
    console.log('\n=== 4. INFERENCIA POR CONTACTOS (>80% en un país) ===');
    
    const contactRes = await client.query(`
      WITH company_country_contacts AS (
        SELECT 
          c.id,
          c.name,
          cc.country_code,
          COUNT(*) as contact_count
        FROM public.companies c
        LEFT JOIN public.contacts con ON con.company_id = c.id
        LEFT JOIN public.companies_countries cc ON cc.id = con.country_id
        WHERE c.country IS NULL 
          AND c.website IS NOT NULL
          AND cc.country_code IS NOT NULL
        GROUP BY c.id, c.name, cc.country_code
      ),
      company_totals AS (
        SELECT 
          ccc.id,
          ccc.name,
          ccc.country_code,
          ccc.contact_count,
          SUM(ccc.contact_count) OVER (PARTITION BY ccc.id) as total_contacts
        FROM company_country_contacts ccc
      )
      SELECT 
        id,
        name,
        country_code,
        contact_count,
        total_contacts,
        ROUND(100.0 * contact_count / total_contacts, 1) as percentage
      FROM company_totals
      WHERE ROUND(100.0 * contact_count / total_contacts, 1) >= 80
      ORDER BY percentage DESC
      LIMIT 30;
    `);

    console.log(`  Compañías con >80% contactos en un país: ${contactRes.rows.length}`);
    const countryDistribution = {};
    contactRes.rows.forEach(row => {
      const country = countryMap[row.country_code] || row.country_code;
      countryDistribution[country] = (countryDistribution[country] || 0) + 1;
    });
    
    Object.entries(countryDistribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .forEach(([country, count]) => {
        console.log(`    ${country}: ${count} compañías`);
      });

    // 6. Resumen de oportunidades
    console.log('\n=== 5. RESUMEN DE OPORTUNIDADES DE ENRIQUECIMIENTO ===');
    
    const opportunitiesRes = await client.query(`
      SELECT 
        COUNT(*) as total_sin_pais,
        COUNT(CASE WHEN website IS NOT NULL THEN 1 END) as con_website,
        COUNT(CASE WHEN linkedin_url IS NOT NULL THEN 1 END) as con_linkedin,
        COUNT(CASE WHEN description IS NOT NULL THEN 1 END) as con_descripcion,
        COUNT(CASE WHEN name NOT LIKE '%Unknown%' THEN 1 END) as nombres_validos
      FROM public.companies
      WHERE country IS NULL;
    `);

    const opp = opportunitiesRes.rows[0];
    console.log(`  Total sin país: ${opp.total_sin_pais}`);
    console.log(`  Con website: ${opp.con_website} (${Math.round(100*opp.con_website/opp.total_sin_pais)}%)`);
    console.log(`  Con LinkedIn: ${opp.con_linkedin} (${Math.round(100*opp.con_linkedin/opp.total_sin_pais)}%)`);
    console.log(`  Con descripción: ${opp.con_descripcion} (${Math.round(100*opp.con_descripcion/opp.total_sin_pais)}%)`);
    console.log(`  Nombres válidos (no 'Unknown'): ${opp.nombres_validos} (${Math.round(100*opp.nombres_validos/opp.total_sin_pais)}%)`);

    // 7. Estado de normalización actual
    console.log('\n=== 6. ESTADO DE NORMALIZACIÓN ACTUAL (países existentes) ===');
    
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

    console.log(`  Formatos actuales de país:`);
    normRes.rows.forEach(row => {
      console.log(`    "${row.country}": ${row.cantidad}`);
    });

    console.log('\n✅ Diagnóstico completado\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

runDiagnostic();
