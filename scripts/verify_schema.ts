import { conConexionDirecta } from '../lib/db/direct';

async function verify() {
  console.log('=== VERIFICANDO ESQUEMA DE COMPAÑÍAS ===\n');
  
  await conConexionDirecta(async (client) => {
    // Verificar columnas relacionadas con país
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' 
        AND table_name = 'companies'
        AND (column_name ILIKE '%country%' OR column_name ILIKE '%location%' OR column_name ILIKE '%hq%')
      ORDER BY ordinal_position;
    `);
    
    console.log('Columnas relacionadas con país/ubicación:\n');
    result.rows.forEach((col: any) => {
      console.log(`  Column: ${col.column_name}`);
      console.log(`    Type: ${col.data_type}`);
      console.log(`    Nullable: ${col.is_nullable}`);
      console.log(`    Default: ${col.column_default || 'none'}\n`);
    });

    // Ver muestra de datos en la columna country
    const sample = await client.query(`
      SELECT DISTINCT country, COUNT(*) as qty
      FROM public.companies
      GROUP BY country
      ORDER BY qty DESC
      LIMIT 20;
    `);
    
    console.log('\nPrimeros 20 valores distintos en columna country:');
    sample.rows.forEach((row: any) => {
      console.log(`  "${row.country}": ${row.qty}`);
    });
  });
}

verify().catch(console.error);
