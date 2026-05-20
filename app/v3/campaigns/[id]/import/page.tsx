import { notFound } from "next/navigation";
import { getCampaign } from "@/app/actions/v3/campaigns";
import { getCsvImportsForCampaign } from "@/app/actions/v3/csv-import";
import { CsvReviewView } from "./_components/csv-review-view";

interface ImportPageProps {
  params: Promise<{ id: string }>;
}

export default async function ImportPage({ params }: ImportPageProps) {
  const { id } = await params;
  
  const [campaign, csvImports] = await Promise.all([
    getCampaign(id),
    getCsvImportsForCampaign(id),
  ]);

  if (!campaign) {
    notFound();
  }

  const pendingImports = csvImports.filter((i) => i.status === "pending_review");

  return (
    <CsvReviewView
      campaign={campaign}
      imports={pendingImports}
    />
  );
}
