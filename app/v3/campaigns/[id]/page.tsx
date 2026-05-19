import { notFound } from "next/navigation";
import { getCampaign, getCampaignAccounts } from "@/app/actions/v3/campaigns";
import { getCsvImportsForCampaign } from "@/app/actions/v3/csv-import";
import { getCampaignAccountsWithDigest } from "@/lib/v3/digest";
import { CampaignDetailView } from "./_components/campaign-detail-view";

interface CampaignPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ add?: string; import?: string }>;
}

export default async function CampaignPage({ params, searchParams }: CampaignPageProps) {
  const { id } = await params;
  const { add, import: importParam } = await searchParams;
  
  const [campaign, accounts, csvImports, accountsWithDigest] = await Promise.all([
    getCampaign(id),
    getCampaignAccounts(id),
    getCsvImportsForCampaign(id),
    getCampaignAccountsWithDigest(id),
  ]);

  if (!campaign) {
    notFound();
  }

  return (
    <CampaignDetailView
      campaign={campaign}
      accounts={accounts}
      accountsWithDigest={accountsWithDigest}
      csvImports={csvImports}
      initialAddDialogOpen={add === "true"}
      initialImportDialogOpen={importParam === "true"}
    />
  );
}
