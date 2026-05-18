/**
 * Script para ejecutar las migraciones de v3
 * Ejecuta los scripts SQL en orden contra Supabase
 * 
 * Uso: node --env-file=/vercel/share/.env.project scripts/run-v3-migrations.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('[v0] Error: Missing SUPABASE env vars');
  console.error('  NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? 'OK' : 'MISSING');
  console.error('  SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? 'OK' : 'MISSING');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const migrations = [
  '200_v3_schema.sql',
  '201_v3_rls.sql',
  '202_v3_seed_job_titles.sql',
];

async function runMigration(filename) {
  const filePath = join(__dirname, filename);
  console.log(`\n[v0] Running ${filename}...`);
  
  try {
    const sql = readFileSync(filePath, 'utf8');
    
    // Execute the SQL
    const { error } = await supabase.rpc('exec_sql', { sql_string: sql });
    
    if (error) {
      // If exec_sql doesn't exist, try direct query via REST
      // This is a fallback - ideally we'd use the SQL editor or psql
      console.error(`[v0] RPC error for ${filename}:`, error.message);
      console.log('[v0] Note: You may need to run this SQL directly in Supabase SQL Editor');
      return false;
    }
    
    console.log(`[v0] Completed ${filename}`);
    return true;
  } catch (err) {
    console.error(`[v0] Error reading/executing ${filename}:`, err.message);
    return false;
  }
}

async function main() {
  console.log('[v0] Starting v3 migrations...');
  console.log('[v0] Supabase URL:', supabaseUrl);
  
  let allSuccess = true;
  
  for (const migration of migrations) {
    const success = await runMigration(migration);
    if (!success) {
      allSuccess = false;
      // Continue with other migrations anyway
    }
  }
  
  if (allSuccess) {
    console.log('\n[v0] All migrations completed successfully!');
  } else {
    console.log('\n[v0] Some migrations failed. Please run them manually in Supabase SQL Editor.');
    console.log('[v0] Scripts are located in: scripts/200_v3_schema.sql, 201_v3_rls.sql, 202_v3_seed_job_titles.sql');
  }
}

main().catch(console.error);
