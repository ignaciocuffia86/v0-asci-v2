"use server";

import { createClient } from "@/lib/supabase/server";

export async function createIngestionLog(filename: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from("ingestion_logs")
    .insert({
      uploaded_by: user.id,
      filename,
      status: "processing",
      total_rows: 0,
      processed_rows: 0,
      errors: [],
    })
    .select("id")
    .single();

  if (error) {
    console.error("Error creating log:", error);
    return null;
  }

  return data.id;
}

export async function completeIngestionLog(logId: string, stats: any) {
  const supabase = await createClient();
  
  await supabase
    .from("ingestion_logs")
    .update({
      ...stats,
      completed_at: new Date().toISOString(),
    })
    .eq("id", logId);
}

export async function ingestBatch(rows: any[], logId: string) {
  const supabase = await createClient();
  let processedCount = 0;

  try {
    for (const row of rows) {
      // 1. Validate essential data
      if (!row.person_linkedin_url || !row.company_name) continue;

      // 2. Handle Company
      let companyId = null;
      
      // Try to find company by exact name match first (fastest)
      const { data: existingCompany } = await supabase
        .from("companies")
        .select("id")
        .eq("name", row.company_name)
        .single();

      if (existingCompany) {
        companyId = existingCompany.id;
      } else {
        // Try fuzzy match if enabled (requires pg_trgm)
        // For now, we'll stick to exact match or create new to keep it simple and fast for batching
        // We can add a separate "company deduplication" job later
        
        const { data: newCompany, error: companyError } = await supabase
          .from("companies")
          .insert({
            name: row.company_name,
            linkedin_url: row.company_linkedin_url || null,
            website: row.company_website || null,
            industry: row.company_industry || null,
            country: row.company_country || null,
            logo_url: row.company_logo_url || null,
          })
          .select("id")
          .single();

        if (!companyError && newCompany) {
          companyId = newCompany.id;
        } else if (companyError?.code === '23505') { 
          // Unique violation (race condition), fetch again
           const { data: retryCompany } = await supabase
            .from("companies")
            .select("id")
            .eq("name", row.company_name)
            .single();
            if (retryCompany) companyId = retryCompany.id;
        }
      }

      if (!companyId) continue; // Skip if company creation failed

      // 3. Handle Contact
      // Check if contact exists
      const { data: existingContact } = await supabase
        .from("contacts")
        .select("id")
        .eq("linkedin_url", row.person_linkedin_url)
        .single();

      const contactData = {
        linkedin_url: row.person_linkedin_url,
        first_name: row.first_name,
        last_name: row.last_name,
        full_name: row.full_name,
        headline: row.headline,
        about: row.about,
        current_company_id: companyId,
        current_position_title: row.current_position,
        current_position_description: row.current_position_description,
        current_position_started: row.current_position_started_on ? new Date(row.current_position_started_on).toISOString() : null,
        previous_positions: parsePreviousPositions(row),
        country: row.person_country,
        profile_picture_url: row.person_image_url,
        processed: false, // Mark for signal reprocessing
      };

      if (existingContact) {
        await supabase
          .from("contacts")
          .update({
            ...contactData,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingContact.id);
      } else {
        await supabase
          .from("contacts")
          .insert(contactData);
      }

      processedCount++;
    }

    // Update log progress (optional, but good for real-time if we were polling)
    // For now we just return stats to client
    
    return { success: true, processed: processedCount };
  } catch (error) {
    console.error("Batch processing error:", error);
    return { success: false, error: String(error) };
  }
}

function parsePreviousPositions(row: any) {
  const positions = [];
  // The CSV has columns like previous_position_1, previous_company_1, etc.
  // We'll loop through 1 to 10 (arbitrary limit based on CSV structure)
  for (let i = 1; i <= 10; i++) {
    if (row[`previous_position_${i}`] && row[`previous_company_${i}`]) {
      positions.push({
        title: row[`previous_position_${i}`],
        company: row[`previous_company_${i}`],
        description: row[`previous_position_${i}_description`],
        start_date: row[`previous_position_${i}_started_on`],
        end_date: row[`previous_position_${i}_ended_on`],
      });
    }
  }
  return positions;
}
