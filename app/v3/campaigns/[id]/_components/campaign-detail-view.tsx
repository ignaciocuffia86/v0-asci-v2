"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft,
  Plus,
  Upload,
  Search,
  MoreHorizontal,
  Trash2,
  Eye,
  Sparkles,
  Building2,
  Globe,
  Users,
  TrendingUp,
  ChevronRight,
  Cpu,
} from "lucide-react";
import {
  type Campaign,
  type CampaignAccount,
  removeAccountFromCampaign,
} from "@/app/actions/v3/campaigns";
import { type CsvImport } from "@/app/actions/v3/csv-import";
import { AddAccountDialog } from "./add-account-dialog";
import { CsvImportDialog } from "./csv-import-dialog";
import { cn } from "@/lib/utils";

interface AccountWithDigest {
  id: string;
  company_id: string;
  status: string;
  prospection_status: string | null;
  tech_radar_run_at: string | null;
  apollo_run_at: string | null;
  added_at: string;
  companies: {
    id: string;
    name: string;
    domain: string | null;
    industry: string | null;
    linkedin_url: string | null;
    logo_url: string | null;
  } | null;
  digest: {
    id: string;
    new_items_count: number;
    last_user_seen_at: string | null;
    signal_types_matched: string[];
    contact_ids: string[];
  }[] | null;
}

interface CampaignDetailViewProps {
  campaign: Campaign;
  accounts: CampaignAccount[];
  accountsWithDigest: AccountWithDigest[];
  csvImports: CsvImport[];
  initialAddDialogOpen?: boolean;
  initialImportDialogOpen?: boolean;
}

const CAMPAIGN_TYPE_CONFIG = {
  monitorear: {
    label: "Monitoreo",
    icon: Eye,
    color: "bg-blue-500/10 text-blue-500",
  },
  prospectar: {
    label: "Prospección",
    icon: Search,
    color: "bg-green-500/10 text-green-500",
  },
  descubrir: {
    label: "Descubrimiento",
    icon: Sparkles,
    color: "bg-purple-500/10 text-purple-500",
  },
};

export function CampaignDetailView({
  campaign,
  accounts,
  accountsWithDigest,
  csvImports,
  initialAddDialogOpen = false,
  initialImportDialogOpen = false,
}: CampaignDetailViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(initialAddDialogOpen);
  const [csvDialogOpen, setCsvDialogOpen] = useState(initialImportDialogOpen);
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    account: CampaignAccount | null;
  }>({ open: false, account: null });
  const [isDeleting, setIsDeleting] = useState(false);

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

  const config = CAMPAIGN_TYPE_CONFIG[campaign.type];
  const Icon = config.icon;

  const filteredAccounts = accountsWithDigest.filter((account) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      account.companies?.name?.toLowerCase().includes(query) ||
      account.companies?.domain?.toLowerCase().includes(query)
    );
  });

  const handleRemoveAccount = async () => {
    if (!deleteDialog.account) return;
    setIsDeleting(true);

    try {
      await removeAccountFromCampaign(campaign.id, deleteDialog.account.id);
      router.refresh();
    } catch (error) {
      console.error("Error removing account:", error);
    } finally {
      setIsDeleting(false);
      setDeleteDialog({ open: false, account: null });
    }
  };

  const pendingImports = csvImports.filter((i) => i.status === "pending_review");
  const hasAccounts = accounts.length > 0;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/v3/campaigns">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
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
      </div>

      {/* Pending Imports Alert */}
      {pendingImports.length > 0 && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-amber-500/10 p-2">
                <Upload className="size-4 text-amber-500" />
              </div>
              <div>
                <p className="font-medium">Imports pendientes de revisión</p>
                <p className="text-sm text-muted-foreground">
                  {pendingImports.length} archivo(s) con matches para revisar
                </p>
              </div>
            </div>
            <Button variant="outline" asChild>
              <Link href={`/v3/campaigns/${campaign.id}/import`}>Revisar</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Empty State - No accounts yet */}
      {!hasAccounts && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-muted p-4 mb-4">
              <Building2 className="size-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Sin cuentas en esta campaña</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-md">
              Agrega cuentas manualmente buscando empresas, o importa un listado desde CSV para comenzar a monitorear señales y buscar decision makers.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setCsvDialogOpen(true)}>
                <Upload className="size-4 mr-2" />
                Importar CSV
              </Button>
              <Button onClick={() => setAddDialogOpen(true)}>
                <Plus className="size-4 mr-2" />
                Agregar Cuenta
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Accounts List - When has accounts */}
      {hasAccounts && (
        <>
          {/* Search */}
          {accounts.length > 3 && (
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Buscar cuenta..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          )}

          {/* Account Cards */}
          <div className="grid gap-4">
            {filteredAccounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                campaignId={campaign.id}
                onDelete={() => setDeleteDialog({ open: true, account: accounts.find(a => a.id === account.id) || null })}
              />
            ))}
          </div>

          {filteredAccounts.length === 0 && searchQuery && (
            <div className="text-center py-8 text-muted-foreground">
              No se encontraron cuentas que coincidan con &quot;{searchQuery}&quot;
            </div>
          )}
        </>
      )}

      {/* Dialogs */}
      <AddAccountDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        campaignId={campaign.id}
        onSuccess={() => router.refresh()}
      />

      <CsvImportDialog
        open={csvDialogOpen}
        onOpenChange={setCsvDialogOpen}
        campaignId={campaign.id}
        onSuccess={() => router.refresh()}
      />

      <AlertDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog({ open, account: deleteDialog.account })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar cuenta</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de eliminar &quot;{deleteDialog.account?.company?.name}&quot; de esta
              campaña?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveAccount}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Account Card Component
interface AccountCardProps {
  account: AccountWithDigest;
  campaignId: string;
  onDelete: () => void;
}

function AccountCard({ account, campaignId, onDelete }: AccountCardProps) {
  const company = account.companies;
  const digest = account.digest?.[0]; // Array from Supabase join
  
  const hasData = account.tech_radar_run_at || account.apollo_run_at;
  const contactCount = digest?.contact_ids?.length || 0;
  const signalCount = digest?.signal_types_matched?.length || 0;
  const newItems = digest?.new_items_count || 0;

  return (
    <Card className="group hover:shadow-md transition-shadow">
      <CardContent className="p-0">
        <Link 
          href={`/v3/campaigns/${campaignId}/accounts/${account.id}`}
          className="block"
        >
          <div className="flex items-center gap-4 p-4">
            {/* Company Logo */}
            <div className={cn(
              "flex size-14 shrink-0 items-center justify-center rounded-lg text-xl font-semibold overflow-hidden",
              "bg-muted"
            )}>
              {company?.logo_url ? (
                <Image
                  src={company.logo_url}
                  alt={company.name || ""}
                  width={56}
                  height={56}
                  className="size-14 object-contain bg-white"
                />
              ) : (
                <span className="text-muted-foreground">
                  {company?.name?.charAt(0).toUpperCase() || "?"}
                </span>
              )}
            </div>

            {/* Company Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold truncate">{company?.name || "Sin nombre"}</h3>
                {company?.domain && (
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <Globe className="size-3" />
                    {company.domain}
                  </span>
                )}
              </div>
              
              {company?.industry && (
                <p className="text-sm text-muted-foreground">{company.industry}</p>
              )}

              {/* Stats Row */}
              {hasData && (
                <div className="flex items-center gap-4 mt-2">
                  {contactCount > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Users className="size-3.5 text-green-500" />
                      <span>{contactCount} DMs</span>
                    </div>
                  )}
                  {signalCount > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <TrendingUp className="size-3.5 text-amber-500" />
                      <span>{signalCount} señales</span>
                    </div>
                  )}
                  {newItems > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {newItems} nuevos
                    </Badge>
                  )}
                </div>
              )}

              {/* Prospection Status */}
              {!hasData && (
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="outline" className="text-xs">
                    Pendiente de prospección
                  </Badge>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <ChevronRight className="size-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>
        </Link>

        {/* Quick Actions (visible on hover) */}
        <div className="border-t px-4 py-2 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity bg-muted/30">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {account.tech_radar_run_at && (
              <span className="flex items-center gap-1">
                <Cpu className="size-3" />
                Tech Radar ejecutado
              </span>
            )}
            {account.apollo_run_at && (
              <span className="flex items-center gap-1">
                <Users className="size-3" />
                Apollo ejecutado
              </span>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/v3/campaigns/${campaignId}/accounts/${account.id}`}>
                  <Eye className="size-4 mr-2" />
                  Ver detalles
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={(e) => {
                  e.preventDefault();
                  onDelete();
                }}
              >
                <Trash2 className="size-4 mr-2" />
                Eliminar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}
