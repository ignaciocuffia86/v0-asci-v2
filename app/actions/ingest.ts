"use server";

import { createClient } from "@/lib/supabase/server";

export async function createImportBatch(filename: string, totalRows: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from("import_batches")
    .insert({
      user_id: user.id,
      filename,
      status: "pending",
      total_rows: totalRows,
      processed_rows: 0,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Error creating import batch:", error);
    return null;
  }

  return data.id;
}

export async function uploadBatchRows(batchId: string, rows: any[]) {
  const supabase = await createClient();
  
  // Map CSV rows to the expected JSON structure for the DB function
  // We keep the raw keys as they come from the CSV parser, but ensure they match what process_import_batch expects
  const formattedRows = rows.map(row => ({
    batch_id: batchId,
    row_data: {
      // Map CSV columns to standardized keys expected by PL/pgSQL function
      company_name: row.company_name,
      company_linkedin_url: row.company_linkedin_url,
      company_website: row.company_website,
      company_industry: row.company_industry,
      company_country: row.company_country,
      company_logo_url: row.company_logo_url,
      
      linkedin_url: row.person_linkedin_url, // Note mapping
      first_name: row.first_name,
      last_name: row.last_name,
      full_name: row.full_name,
      headline: row.headline,
      about: row.about,
      current_position: row.current_position,
      current_position_description: row.current_position_description,
      current_position_started_at: row.current_position_started_on, // Note mapping
      country: row.person_country, // Note mapping
      profile_picture_url: row.person_image_url, // Note mapping
      
      email1: row.email1,
      email1_type: row.email1_type,
      email1_status: row.email1_status,
      email2: row.email2,
      email2_type: row.email2_type,
      email2_status: row.email2_status,
      email3: row.email3,
      email3_type: row.email3_type,
      email3_status: row.email3_status,
      email4: row.email4,
      email4_type: row.email4_type,
      email4_status: row.email4_status,
      phone1: row.phone1,
      phone1_type: row.phone1_type,
      phone1_status: row.phone1_status,
      phone2: row.phone2,
      phone2_type: row.phone2_type,
      phone2_status: row.phone2_status,

      // Previous positions (1-6)
      previous_company_1: row.previous_company_1,
      previous_position_1: row.previous_position_1,
      previous_position_1_description: row.previous_position_1_description,
      previous_position_1_started_at: row.previous_position_1_started_on,
      previous_position_1_ended_at: row.previous_position_1_ended_on,
      
      previous_company_2: row.previous_company_2,
      previous_position_2: row.previous_position_2,
      previous_position_2_description: row.previous_position_2_description,
      previous_position_2_started_at: row.previous_position_2_started_on,
      previous_position_2_ended_at: row.previous_position_2_ended_on,
      
      previous_company_3: row.previous_company_3,
      previous_position_3: row.previous_position_3,
      previous_position_3_description: row.previous_position_3_description,
      previous_position_3_started_at: row.previous_position_3_started_on,
      previous_position_3_ended_at: row.previous_position_3_ended_on,
      
      previous_company_4: row.previous_company_4,
      previous_position_4: row.previous_position_4,
      previous_position_4_description: row.previous_position_4_description,
      previous_position_4_started_at: row.previous_position_4_started_on,
      previous_position_4_ended_at: row.previous_position_4_ended_on,
      
      previous_company_5: row.previous_company_5,
      previous_position_5: row.previous_position_5,
      previous_position_5_description: row.previous_position_5_description,
      previous_position_5_started_at: row.previous_position_5_started_on,
      previous_position_5_ended_at: row.previous_position_5_ended_on,
      
      previous_company_6: row.previous_company_6,
      previous_position_6: row.previous_position_6,
      previous_position_6_description: row.previous_position_6_description,
      previous_position_6_started_at: row.previous_position_6_started_on,
      previous_position_6_ended_at: row.previous_position_6_ended_on,
    },
    status: 'pending'
  }));

  const { error } = await supabase
    .from("import_rows")
    .insert(formattedRows);

  if (error) {
    console.error("Error uploading batch rows:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function triggerBatchProcessing(batchId: string) {
  const supabase = await createClient();
  
  try {
    const { data, error } = await supabase.rpc('process_import_batch', { 
      p_batch_id: batchId,
      p_limit: 10 
    });

    if (error) {
      console.error("[v0] RPC Error:", error);
      return { success: false, error: error.message };
    }

    return { success: true, processedCount: data };
  } catch (error: any) {
    console.error("[v0] Trigger Error:", error);
    return { success: false, error: error.message };
  }
}

export async function getBatchStatus(batchId: string) {
  const supabase = await createClient();
  
  const { data, error } = await supabase
    .from("import_batches")
    .select("*")
    .eq("id", batchId)
    .single();

  if (error) {
    return null;
  }

  return data;
}
