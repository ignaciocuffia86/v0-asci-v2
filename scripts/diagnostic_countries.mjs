#!/usr/bin/env node

/**
 * Diagnóstico de normalización de países en tabla de compañías
 * 
 * Ejecutar:
 *   node --env-file-if-exists=/vercel/share/.env.project scripts/diagnostic_countries.mjs
 */

import { Client } from "pg";

function limpiarSslmode(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete("sslmode");
    return u.toString();
  } catch {
    return url.replace(/[?&]sslmode=[^&]*/g, "");
  }
}

async function conectar() {
  const url = process.env.POSTGRES_URL_NON_POOLING;
  if (!url) {
    throw new Error(
      "Falta POSTGRES_URL_NON_POOLING. Ejecuta con: node --env-file-if-exists=/vercel/share/.env.project"
    );
  }

  const client = new Client({
    connectionString: limpiarSslmode(url),
    ssl: { rejectUnauthorized: false },
    statement_timeout: 60_000,
    application_name: "asci-diagnostic-countries",
  });

  await client.connect();
  return client;
}

async function diagnostico() {
  const client = await conectar();

  try {
    console.log("📊 DIAGNÓSTICO DE COMPAÑÍAS - NORMALIZACIÓN DE PAÍSES\n");
    console.log("=".repeat(70));

    // 1. Estadísticas generales
    console.log("\n1️⃣  ESTADÍSTICAS GENERALES");
    console.log("-".repeat(70));
    let res = await client.query(`
      SELECT 
        COUNT(*) as total_compañias,
        COUNT(CASE WHEN country IS NULL THEN 1 END) as sin_pais,
        COUNT(CASE WHEN country IS NOT NULL THEN 1 END) as con_pais,
        COUNT(DISTINCT country) as paises_distintos,
        COUNT(CASE WHEN country = '' THEN 1 END) as pais_vacio
      FROM public.companies;
    `);
    console.log(res.rows[0]);

    // 2. Compañías SIN país
    console.log("\n2️⃣  TOP 20 COMPAÑÍAS SIN PAÍS");
    console.log("-".repeat(70));
    res = await client.query(`
      SELECT 
        id,
        name, 
        website, 
        linkedin_url,
        COALESCE(industry, '-') as industry,
        COALESCE(description, '-') as description,
        created_at::date
      FROM public.companies
      WHERE country IS NULL OR country = ''
      ORDER BY created_at DESC
      LIMIT 20;
    `);
    console.log(`Total sin país: ${res.rows.length}\n`);
    res.rows.forEach((row, i) => {
      console.log(
        `${i + 1}. ${row.name} | Web: ${row.website || "—"} | LinkedIn: ${
          row.linkedin_url ? "✓" : "—"
        }`
      );
      if (row.description && row.description !== "-") {
        console.log(`   📝 ${row.description.substring(0, 80)}...`);
      }
    });

    // 3. Distribución por país (top 20)
    console.log("\n3️⃣  DISTRIBUCIÓN TOP 20 PAÍSES (CON PAÍS)");
    console.log("-".repeat(70));
    res = await client.query(`
      SELECT 
        country,
        COUNT(*) as cantidad,
        ROUND(100.0 * COUNT(*) / (
          SELECT COUNT(*) FROM public.companies 
          WHERE country IS NOT NULL AND country != ''
        ), 1) as porcentaje
      FROM public.companies
      WHERE country IS NOT NULL AND country != ''
      GROUP BY country
      ORDER BY cantidad DESC
      LIMIT 20;
    `);
    res.rows.forEach((row) => {
      const bar = "█".repeat(Math.ceil(row.porcentaje / 2));
      console.log(`  ${row.country.padEnd(20)} ${bar} ${row.cantidad} (${row.porcentaje}%)`);
    });

    // 4. Estructura de tabla
    console.log("\n4️⃣  COLUMNAS DE TABLA 'companies'");
    console.log("-".repeat(70));
    res = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' 
        AND table_name = 'companies'
      ORDER BY ordinal_position;
    `);
    console.log("Columnas relevantes para análisis:");
    const relevantes = ["name", "country", "website", "linkedin_url", "industry", "description", "created_at"];
    res.rows
      .filter((col) => relevantes.includes(col.column_name))
      .forEach((col) => {
        console.log(`  • ${col.column_name.padEnd(18)} ${col.data_type.padEnd(15)} (nullable: ${col.is_nullable})`);
      });

    // 5. Compañías con nombres que pueden contener país
    console.log("\n5️⃣  COMPAÑÍAS CON PAÍS EN EL NOMBRE (muestra de 20)");
    console.log("-".repeat(70));
    res = await client.query(`
      SELECT 
        id,
        name,
        country,
        website,
        created_at::date
      FROM public.companies
      WHERE country IS NULL 
        AND (
          name ILIKE '% Argentina' 
          OR name ILIKE '% Chile' 
          OR name ILIKE '% Mexico'
          OR name ILIKE '% Brasil'
          OR name ILIKE '% España'
          OR name ILIKE '% USA'
          OR name ILIKE '% UK'
          OR name ILIKE '% Canada'
          OR name ILIKE '% Colombia'
          OR name ILIKE '% Peru'
          OR name ILIKE '% Bolivia'
          OR name ILIKE '% Paraguay'
          OR name ILIKE '% Uruguay'
          OR name ILIKE '% Venezuela'
          OR name ILIKE '% Ecuador'
          OR name ILIKE '% Guatemala'
          OR name ILIKE '% Costa Rica'
          OR name ILIKE '% Panama'
          OR name ILIKE '% Dominican Republic'
          OR name ILIKE '% Puerto Rico'
        )
      ORDER BY created_at DESC
      LIMIT 20;
    `);
    console.log(`Encontradas: ${res.rows.length} compañías\n`);
    res.rows.forEach((row) => {
      console.log(`  • "${row.name}" [Web: ${row.website || "—"}]`);
    });

    // 6. Análisis de dominios
    console.log("\n6️⃣  ANÁLISIS DE DOMINIOS (extensiones geográficas en websites)");
    console.log("-".repeat(70));
    res = await client.query(`
      SELECT 
        CASE 
          WHEN website ILIKE '%.ar' THEN 'Argentina (.ar)'
          WHEN website ILIKE '%.cl' THEN 'Chile (.cl)'
          WHEN website ILIKE '%.mx' THEN 'Mexico (.mx)'
          WHEN website ILIKE '%.br' THEN 'Brasil (.br)'
          WHEN website ILIKE '%.es' THEN 'España (.es)'
          WHEN website ILIKE '%.uk' THEN 'UK (.uk)'
          WHEN website ILIKE '%.co' THEN 'Colombia (.co)'
          WHEN website ILIKE '%.pe' THEN 'Peru (.pe)'
          WHEN website ILIKE '%.ve' THEN 'Venezuela (.ve)'
          WHEN website ILIKE '%.ec' THEN 'Ecuador (.ec)'
          WHEN website ILIKE '%.gt' THEN 'Guatemala (.gt)'
          WHEN website ILIKE '%.cr' THEN 'Costa Rica (.cr)'
          WHEN website ILIKE '%.pa' THEN 'Panama (.pa)'
          WHEN website ILIKE '%.do' THEN 'Dominican Republic (.do)'
          WHEN website ILIKE '%.pr' THEN 'Puerto Rico (.pr)'
          WHEN website ILIKE '%.uy' THEN 'Uruguay (.uy)'
          WHEN website ILIKE '%.py' THEN 'Paraguay (.py)'
          WHEN website ILIKE '%.bo' THEN 'Bolivia (.bo)'
          ELSE 'Otros'
        END as dominio,
        COUNT(*) as cantidad
      FROM public.companies
      WHERE country IS NULL AND website IS NOT NULL
      GROUP BY dominio
      ORDER BY cantidad DESC;
    `);
    console.log("Compañías SIN país pero CON dominio geográfico identificable:\n");
    res.rows.forEach((row) => {
      if (row.dominio !== "Otros") {
        console.log(`  ${row.dominio.padEnd(25)} ${row.cantidad} compañías`);
      }
    });

    // 7. Información sobre campos relacionados
    console.log("\n7️⃣  ¿EXISTE CAMPO DE TAMAÑO DE COMPAÑÍA?");
    console.log("-".repeat(70));
    res = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' 
        AND table_name = 'companies'
        AND (
          column_name ILIKE '%size%'
          OR column_name ILIKE '%employee%'
          OR column_name ILIKE '%headcount%'
          OR column_name ILIKE '%team%'
        );
    `);
    if (res.rows.length === 0) {
      console.log("❌ No se encontró campo de tamaño, empleados o headcount");
      console.log("   Columnas disponibles: name, website, industry, country, description,");
      console.log("   linkedin_url, logo_url, is_public, ticker, cik, stock_exchange, etc.");
    } else {
      console.log("✓ Campos encontrados:");
      res.rows.forEach((row) => {
        console.log(`  • ${row.column_name} (${row.data_type})`);
      });
    }

    // 8. Tabla de contactos - ¿hay empleados asignados por país?
    console.log("\n8️⃣  EMPLEADOS ASIGNADOS (contactos) POR PAÍS DE COMPAÑÍA");
    console.log("-".repeat(70));
    res = await client.query(`
      SELECT 
        COALESCE(c.country, 'SIN PAÍS') as pais_empresa,
        COUNT(ct.id) as total_contactos,
        COUNT(ct.country) as contactos_con_pais,
        ROUND(100.0 * COUNT(ct.country) / COUNT(ct.id), 1) as pct_con_pais
      FROM public.companies c
      LEFT JOIN public.contacts ct ON ct.current_company_id = c.id
      WHERE ct.id IS NOT NULL
      GROUP BY c.country
      ORDER BY total_contactos DESC
      LIMIT 15;
    `);
    console.log("(Esto puede ayudar a inferir país si la mayoría de contactos está en un país)\n");
    res.rows.forEach((row) => {
      console.log(
        `  ${(row.pais_empresa || "SIN PAÍS").padEnd(25)} ${row.total_contactos} contactos (${row.pct_con_pais}% con país)`
      );
    });

    console.log("\n" + "=".repeat(70));
    console.log("✅ Diagnóstico completado\n");
  } finally {
    await client.end();
  }
}

diagnostico().catch((err) => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
