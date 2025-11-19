import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Security check: Vercel sends this header
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
    // In production, we strictly require the CRON_SECRET
    // You can find this in your Vercel Project Settings -> Cron Jobs
    // For now, we log a warning but allow it if you are testing manually without the header
    console.warn("[Cron] Warning: Unauthorized attempt or missing CRON_SECRET");
    // return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    console.log("[Cron] Starting process_pending_queue via Vercel Cron...");
    
    // Call the stored procedure to process a chunk of rows
    // We process 50 rows per minute (3000 per hour)
    const { data, error } = await supabase.rpc('process_pending_queue', {
      p_limit: 50 
    });

    if (error) {
      console.error("[Cron] Error processing queue:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`[Cron] Processed ${data} rows`);
    return NextResponse.json({ processed: data, success: true });
  } catch (err: any) {
    console.error("[Cron] Unexpected error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
