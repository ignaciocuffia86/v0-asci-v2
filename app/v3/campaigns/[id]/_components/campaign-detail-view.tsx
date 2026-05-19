"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  ExternalLink,
} from "lucide-react";
import {
  type Campaign,
  type CampaignAccount,
  removeAccountFromCampaign,
} from "@/app/actions/v3/campaigns";
import { type CsvImport } from "@/app/actions/v3/csv-import";
import { AddAccountDialog } from "./add-account-dialog";
import { CsvImportDialog } from "./csv-import-dialog";

interface CampaignDetailViewProps {
  campaign: Campaign;
  accounts: CampaignAccount[];
  csvImports: CsvImport[];
}

const CAMPAIGN_TYPE_CONFIG = {
  monitorear: {
    label: "Monitoreo",
    icon: Eye,
    color: "bg-blue-500/10 text-blue-500",
  },
  prospectar: {
    label: "Prospeccion",
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
  csvImports,
}: CampaignDetailViewProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [csvDialogOpen, setCsvDialogOpen] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    account: CampaignAccount | null;
  }>({ open: false, account: null });
  const [isDeleting, setIsDeleting] = useState(false);

  const config = CAMPAIGN_TYPE_CONFIG[campaign.type];
  const Icon = config.icon;

  const filteredAccounts = accounts.filter((account) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      account.company?.name?.toLowerCase().includes(query) ||
      account.company?.domain?.toLowerCase().includes(query)
    );
  });

  const handleRemoveAccount = async () => {
    if (!deleteDialog.account) return;
    setIsDeleting(true);

    await removeAccountFromCampaign(campaign.id, deleteDialog.account.id);
    router.refresh();

    setIsDeleting(false);
    setDeleteDialog({ open: false, account: null });
  };

  const pendingImports = csvImports.filter((i) => i.status === "pending_review");

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
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setCsvDialogOpen(true)}>
            <Upload data-icon="inline-start" />
            Importar CSV
          </Button>
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus data-icon="inline-start" />
            Agregar Cuenta
          </Button>
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
                <p className="font-medium">Imports pendientes de revision</p>
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

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Cuentas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{accounts.length}</div>
          </CardContent>
        </Card>
        {campaign.enable_tech_radar && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Tech Radar Completado
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {accounts.filter((a) => a.tech_radar_run_at).length}
              </div>
            </CardContent>
          </Card>
        )}
        {campaign.enable_apollo && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Con DMs Identificados
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {accounts.filter((a) => a.apollo_run_at).length}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Accounts Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Cuentas</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Buscar cuenta..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredAccounts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Building2 className="size-12 text-muted-foreground/50 mb-4" />
              <h3 className="font-medium mb-1">
                {accounts.length === 0 ? "Sin cuentas" : "Sin resultados"}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {accounts.length === 0
                  ? "Agrega cuentas manualmente o importa un CSV"
                  : "No se encontraron cuentas que coincidan con tu busqueda"}
              </p>
              {accounts.length === 0 && (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setCsvDialogOpen(true)}>
                    <Upload data-icon="inline-start" />
                    Importar CSV
                  </Button>
                  <Button onClick={() => setAddDialogOpen(true)}>
                    <Plus data-icon="inline-start" />
                    Agregar Cuenta
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Dominio</TableHead>
                  <TableHead>Industria</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAccounts.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell>
                      <div className="font-medium">{account.company?.name || "—"}</div>
                    </TableCell>
                    <TableCell>
                      {account.company?.domain ? (
                        <a
                          href={`https://${account.company.domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                        >
                          <Globe className="size-3" />
                          {account.company.domain}
                          <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {account.company?.industry || "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={account.status === "whitelisted" ? "secondary" : "outline"}
                      >
                        {account.status === "whitelisted" ? "Activa" : "Blacklist"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setDeleteDialog({ open: true, account })}
                          >
                            <Trash2 data-icon="inline-start" />
                            Eliminar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

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
              Estás seguro de eliminar &quot;{deleteDialog.account?.company?.name}&quot; de esta
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
