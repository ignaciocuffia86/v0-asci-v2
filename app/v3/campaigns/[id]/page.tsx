import { notFound } from "next/navigation";
import { getCampaign, getCampaignAccounts } from "@/app/actions/v3/campaigns";
import { getCsvImportsForCampaign } from "@/app/actions/v3/csv-import";
import { CampaignDetailView } from "./_components/campaign-detail-view";

interface CampaignPageProps {
  params: Promise<{ id: string }>;
}

export default async function CampaignPage({ params }: CampaignPageProps) {
  const { id } = await params;
  
  const [campaign, accounts, csvImports] = await Promise.all([
    getCampaign(id),
    getCampaignAccounts(id),
    getCsvImportsForCampaign(id),
  ]);

  if (!campaign) {
    notFound();
  }

  return (
    <CampaignDetailView
      campaign={campaign}
      accounts={accounts}
      csvImports={csvImports}
    />
  );
}
