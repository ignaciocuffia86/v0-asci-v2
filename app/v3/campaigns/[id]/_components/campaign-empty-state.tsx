"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Upload,
  Building2,
  Users,
  Target,
  Briefcase,
} from "lucide-react";
import { type Campaign } from "@/app/actions/v3/campaigns";
import { type CsvImport } from "@/app/actions/v3/csv-import";
import { AddAccountDialog } from "./add-account-dialog";
import { CsvImportDialog } from "./csv-import-dialog";

const CAMPAIGN_TYPE_CONFIG = {
  outbound: { label: "Outbound", icon: Target, color: "bg-blue-500/10 text-blue-500" },
  inbound: { label: "Inbound", icon: Users, color: "bg-green-500/10 text-green-500" },
  abm: { label: "ABM", icon: Briefcase, color: "bg-purple-500/10 text-purple-500" },
} as const;

interface CampaignEmptyStateProps {
  campaign: Campaign;
  csvImports: CsvImport[];
  initialAddDialogOpen?: boolean;
  initialImportDialogOpen?: boolean;
}

export function CampaignEmptyState({
  campaign,
  csvImports,
  initialAddDialogOpen = false,
  initialImportDialogOpen = false,
}: CampaignEmptyStateProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [addDialogOpen, setAddDialogOpen] = useState(initialAddDialogOpen);
  const [csvDialogOpen, setCsvDialogOpen] = useState(initialImportDialogOpen);

  const config = CAMPAIGN_TYPE_CONFIG[campaign.campaign_type as keyof typeof CAMPAIGN_TYPE_CONFIG] || CAMPAIGN_TYPE_CONFIG.outbound;
  const Icon = config.icon;

  // React to URL search params changes (from sidebar clicks)
  useEffect(() => {
    const addParam = searchParams.get("add");
    const importParam = searchParams.get("import");
    
    if (addParam === "true") {
      setAddDialogOpen(true);
      router.replace(`/v3/campaigns/${campaign.id}`, { scroll: false });
    }
    if (importParam === "true") {
      setCsvDialogOpen(true);
      router.replace(`/v3/campaigns/${campaign.id}`, { scroll: false });
    }
  }, [searchParams, campaign.id, router]);

  const handleAccountAdded = () => {
    setAddDialogOpen(false);
    router.refresh();
  };

  const handleCsvImportComplete = () => {
    setCsvDialogOpen(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/v3/docs" className="hover:text-foreground transition-colors">
          Documentos
        </Link>
        <span>/</span>
        <Link href="/v3/campaigns" className="hover:text-foreground transition-colors">
          Campañas
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">{campaign.name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{campaign.name}</h1>
            <Badge variant="secondary" className={config.color}>
              <Icon className="size-3 mr-1" />
              {config.label}
            </Badge>
          </div>
          {campaign.buyer_persona_text && (
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              {campaign.buyer_persona_text}
            </p>
          )}
        </div>
      </div>

      {/* Empty State */}
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-6 py-16">
          <div className="rounded-full bg-muted p-6">
            <Building2 className="size-12 text-muted-foreground" />
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-xl font-semibold">Agrega cuentas a tu campaña</h3>
            <p className="text-muted-foreground max-w-md">
              Comienza agregando empresas para recibir inteligencia de mercado, 
              detectar señales de compra y encontrar decision makers.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => setAddDialogOpen(true)} className="gap-2">
              <Plus className="size-4" />
              Agregar cuenta
            </Button>
            <Button variant="outline" onClick={() => setCsvDialogOpen(true)} className="gap-2">
              <Upload className="size-4" />
              Importar CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Dialogs */}
      <AddAccountDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        campaignId={campaign.id}
        onSuccess={handleAccountAdded}
      />

      <CsvImportDialog
        open={csvDialogOpen}
        onOpenChange={setCsvDialogOpen}
        campaignId={campaign.id}
        existingImports={csvImports}
        onImportComplete={handleCsvImportComplete}
      />
    </div>
  );
}
