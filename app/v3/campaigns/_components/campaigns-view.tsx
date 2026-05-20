"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
import { Plus, MoreHorizontal, Eye, Search, Sparkles, Trash2 } from "lucide-react";
import { type Campaign, deleteCampaign } from "@/app/actions/v3/campaigns";

interface CampaignsViewProps {
  campaigns: Campaign[];
  accountStats: {
    total: number;
    limit: number;
    remaining: number;
  };
}

const CAMPAIGN_TYPE_CONFIG = {
  monitorear: {
    label: "Monitoreo",
    description: "Solo seguimiento de señales y noticias",
    icon: Eye,
    color: "bg-blue-500/10 text-blue-500",
  },
  prospectar: {
    label: "Prospección",
    description: "Búsqueda de decision makers",
    icon: Search,
    color: "bg-green-500/10 text-green-500",
  },
  descubrir: {
    label: "Descubrimiento",
    description: "ASCI recomienda nuevas cuentas",
    icon: Sparkles,
    color: "bg-purple-500/10 text-purple-500",
  },
};

export function CampaignsView({ campaigns, accountStats }: CampaignsViewProps) {
  const router = useRouter();
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    campaign: Campaign | null;
  }>({ open: false, campaign: null });
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!deleteDialog.campaign) return;
    setIsDeleting(true);
    
    const result = await deleteCampaign(deleteDialog.campaign.id);
    if (result.success) {
      router.refresh();
    }
    
    setIsDeleting(false);
    setDeleteDialog({ open: false, campaign: null });
  };

  const usagePercent = (accountStats.total / accountStats.limit) * 100;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campañas</h1>
          <p className="text-sm text-muted-foreground">
            Gestiona tus listas de cuentas para prospección
          </p>
        </div>
        <Button asChild>
          <Link href="/v3/campaigns/new">
            <Plus data-icon="inline-start" />
            Nueva Campaña
          </Link>
        </Button>
      </div>

      {/* Account Usage */}
      <Card>
        <CardContent className="flex items-center gap-4 p-4">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Cuentas utilizadas</span>
              <span className="text-sm text-muted-foreground">
                {accountStats.total} / {accountStats.limit}
              </span>
            </div>
            <Progress value={usagePercent} className="h-2" />
          </div>
          {accountStats.remaining <= 10 && (
            <Button variant="outline" size="sm">
              Upgrade
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Campaigns Grid */}
      {campaigns.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <div className="rounded-full bg-muted p-3 mb-4">
            <Search className="size-6 text-muted-foreground" />
          </div>
          <h3 className="font-semibold mb-1">Sin campañas</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Crea tu primera campaña para comenzar a monitorear o prospectar cuentas
          </p>
          <Button asChild>
            <Link href="/v3/campaigns/new">
              <Plus data-icon="inline-start" />
              Crear Campaña
            </Link>
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((campaign) => {
            const config = CAMPAIGN_TYPE_CONFIG[campaign.type];
            const Icon = config.icon;

            return (
              <Card key={campaign.id} className="group relative">
                <Link href={`/v3/campaigns/${campaign.id}`} className="absolute inset-0 z-10" />
                <CardHeader className="flex flex-row items-start justify-between pb-2">
                  <div className="flex items-center gap-3">
                    <div className={`rounded-lg p-2 ${config.color}`}>
                      <Icon className="size-4" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{campaign.name}</CardTitle>
                      <Badge variant="secondary" className="mt-1">
                        {config.label}
                      </Badge>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="relative z-20 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={(e) => {
                          e.preventDefault();
                          setDeleteDialog({ open: true, campaign });
                        }}
                      >
                        <Trash2 data-icon="inline-start" />
                        Eliminar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Cuentas</span>
                    <span className="font-medium">{campaign.account_count}</span>
                  </div>
                  {campaign.buyer_persona_text && (
                    <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
                      {campaign.buyer_persona_text}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Delete Dialog */}
      <AlertDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog({ open, campaign: deleteDialog.campaign })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar campaña</AlertDialogTitle>
            <AlertDialogDescription>
              Estás seguro de eliminar la campaña &quot;{deleteDialog.campaign?.name}&quot;?
              Esta acción no se puede deshacer y se eliminarán todas las cuentas asociadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
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
