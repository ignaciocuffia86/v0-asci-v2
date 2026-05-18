import { getCampaigns } from "@/app/actions/v3/campaigns";
import { getWorkspaceAccountStats } from "@/app/actions/v3/campaigns";
import { CampaignsView } from "./_components/campaigns-view";

export default async function CampaignsPage() {
  const [campaigns, stats] = await Promise.all([
    getCampaigns(),
    getWorkspaceAccountStats(),
  ]);

  return <CampaignsView campaigns={campaigns} accountStats={stats} />;
}
