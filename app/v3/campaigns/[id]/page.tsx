import { notFound, redirect } from "next/navigation";
import { getCampaign } from "@/app/actions/v3/campaigns";
import { getCsvImportsForCampaign } from "@/app/actions/v3/csv-import";
import { getCampaignAccountsWithDigest } from "@/lib/v3/digest";
import { CampaignEmptyState } from "./_components/campaign-empty-state";

interface CampaignPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ add?: string; import?: string }>;
}

export default async function CampaignPage({ params, searchParams }: CampaignPageProps) {
  const { id } = await params;
  const { add, import: importParam } = await searchParams;
  
  const [campaign, accountsWithDigest, csvImports] = await Promise.all([
    getCampaign(id),
    getCampaignAccountsWithDigest(id),
    getCsvImportsForCampaign(id),
  ]);

  if (!campaign) {
    notFound();
  }

  // Si hay cuentas, redirigir a la primera cuenta automáticamente
  if (accountsWithDigest.length > 0 && add !== "true" && importParam !== "true") {
    redirect(`/v3/campaigns/${id}/accounts/${accountsWithDigest[0].id}`);
  }

  // Solo mostrar empty state cuando no hay cuentas
  return (
    <CampaignEmptyState
      campaign={campaign}
      csvImports={csvImports}
      initialAddDialogOpen={add === "true"}
      initialImportDialogOpen={importParam === "true"}
    />
  );
}
