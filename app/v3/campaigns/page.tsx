import { getCampaigns } from "@/app/actions/v3/campaigns";
import { getWorkspaceAccountStats } from "@/app/actions/v3/campaigns";
import { CampaignsView } from "./_components/campaigns-view";
import { V3Navbar } from "@/components/v3/navbar";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/v3/workspace";
import { isSuperAdmin } from "@/app/actions/v3/admin";
import { redirect } from "next/navigation";

export default async function CampaignsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) redirect("/auth/login?next=/v3/campaigns");
  
  const workspace = await getCurrentWorkspace(user.id);
  
  const [campaigns, stats, superAdmin] = await Promise.all([
    getCampaigns(),
    getWorkspaceAccountStats(),
    isSuperAdmin(),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <V3Navbar user={user} workspace={workspace} isSuperAdmin={superAdmin} />
      <main className="flex-1">
        <CampaignsView campaigns={campaigns} accountStats={stats} />
      </main>
    </div>
  );
}
