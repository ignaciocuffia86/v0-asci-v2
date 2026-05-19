"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Check,
  X,
  AlertTriangle,
  HelpCircle,
  CheckCircle,
  Loader2,
} from "lucide-react";
import { type Campaign } from "@/app/actions/v3/campaigns";
import {
  type CsvImport,
  type CsvImportRow,
  type CsvImportWithRows,
  getCsvImportWithRows,
  confirmCsvMatch,
  ignoreCsvRow,
} from "@/app/actions/v3/csv-import";

interface CsvReviewViewProps {
  campaign: Campaign;
  imports: CsvImport[];
}

const STATUS_CONFIG = {
  auto_matched: {
    label: "Auto",
    icon: CheckCircle,
    color: "text-green-500",
  },
  needs_review: {
    label: "Revisar",
    icon: HelpCircle,
    color: "text-amber-500",
  },
  ambiguous: {
    label: "Ambiguo",
    icon: AlertTriangle,
    color: "text-orange-500",
  },
  no_match: {
    label: "Sin match",
    icon: X,
    color: "text-red-500",
  },
  confirmed: {
    label: "Confirmado",
    icon: Check,
    color: "text-green-500",
  },
  ignored: {
    label: "Ignorado",
    icon: X,
    color: "text-muted-foreground",
  },
};

export function CsvReviewView({ campaign, imports }: CsvReviewViewProps) {
  const router = useRouter();
  const [selectedImportId, setSelectedImportId] = useState<string | null>(
    imports[0]?.id || null
  );
  const [importData, setImportData] = useState<CsvImportWithRows | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [processingRowId, setProcessingRowId] = useState<string | null>(null);

  // Load import rows when selection changes
  useEffect(() => {
    if (!selectedImportId) {
      setImportData(null);
      return;
    }

    setIsLoading(true);
    getCsvImportWithRows(selectedImportId).then((data) => {
      setImportData(data);
      setIsLoading(false);
    });
  }, [selectedImportId]);

  const handleConfirm = async (row: CsvImportRow, companyId: string) => {
    setProcessingRowId(row.id);
    await confirmCsvMatch(row.id, companyId);
    
    // Reload data
    if (selectedImportId) {
      const updated = await getCsvImportWithRows(selectedImportId);
      setImportData(updated);
    }
    setProcessingRowId(null);
    router.refresh();
  };

  const handleIgnore = async (rowId: string) => {
    setProcessingRowId(rowId);
    await ignoreCsvRow(rowId);
    
    // Reload data
    if (selectedImportId) {
      const updated = await getCsvImportWithRows(selectedImportId);
      setImportData(updated);
    }
    setProcessingRowId(null);
    router.refresh();
  };

  const unresolvedRows = importData?.rows.filter(
    (r) => !["auto_matched", "confirmed", "ignored"].includes(r.match_status)
  ) || [];

  const resolvedCount = (importData?.rows.length || 0) - unresolvedRows.length;

  if (imports.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/v3/campaigns/${campaign.id}`}>
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Revisar Imports</h1>
            <p className="text-sm text-muted-foreground">{campaign.name}</p>
          </div>
        </div>

        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <CheckCircle className="size-12 text-green-500 mb-4" />
          <h3 className="font-semibold mb-1">Todo resuelto</h3>
          <p className="text-sm text-muted-foreground mb-4">
            No hay imports pendientes de revisión
          </p>
          <Button asChild>
            <Link href={`/v3/campaigns/${campaign.id}`}>Volver a la campaña</Link>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/v3/campaigns/${campaign.id}`}>
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Revisar Imports</h1>
            <p className="text-sm text-muted-foreground">{campaign.name}</p>
          </div>
        </div>

        {imports.length > 1 && (
          <Select value={selectedImportId || ""} onValueChange={setSelectedImportId}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Seleccionar import" />
            </SelectTrigger>
            <SelectContent>
              {imports.map((imp) => (
                <SelectItem key={imp.id} value={imp.id}>
                  {imp.filename} ({imp.total_rows} filas)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Progress */}
      {importData && (
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium">Progreso de revisión</p>
              <p className="text-sm text-muted-foreground">
                {resolvedCount} de {importData.rows.length} filas resueltas
              </p>
            </div>
            <Badge variant={unresolvedRows.length === 0 ? "default" : "secondary"}>
              {unresolvedRows.length === 0
                ? "Completado"
                : `${unresolvedRows.length} pendientes`}
            </Badge>
          </CardContent>
        </Card>
      )}

      {/* Rows Table */}
      <Card>
        <CardHeader>
          <CardTitle>Filas pendientes de revisión</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          ) : unresolvedRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle className="size-12 text-green-500 mb-4" />
              <h3 className="font-semibold mb-1">Todas las filas resueltas</h3>
              <p className="text-sm text-muted-foreground">
                Puedes volver a la campaña para ver las cuentas agregadas
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Empresa (CSV)</TableHead>
                  <TableHead>Dominio (CSV)</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Match sugerido</TableHead>
                  <TableHead className="w-32">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unresolvedRows.map((row) => {
                  const statusConfig = STATUS_CONFIG[row.match_status];
                  const StatusIcon = statusConfig.icon;
                  const isProcessing = processingRowId === row.id;

                  return (
                    <TableRow key={row.id}>
                      <TableCell className="text-muted-foreground">{row.row_number}</TableCell>
                      <TableCell className="font-medium">{row.raw_company_name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.raw_domain || "—"}
                      </TableCell>
                      <TableCell>
                        <div className={`flex items-center gap-1.5 ${statusConfig.color}`}>
                          <StatusIcon className="size-4" />
                          <span className="text-sm">{statusConfig.label}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {row.match_candidates && row.match_candidates.length > 0 ? (
                          <Select
                            value={row.matched_company_id || ""}
                            onValueChange={(companyId) => handleConfirm(row, companyId)}
                            disabled={isProcessing}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Seleccionar match" />
                            </SelectTrigger>
                            <SelectContent>
                              {row.match_candidates.map((candidate) => (
                                <SelectItem key={candidate.company_id} value={candidate.company_id}>
                                  <div className="flex flex-col">
                                    <span>{candidate.name}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {candidate.domain || "Sin dominio"} •{" "}
                                      {Math.round(candidate.score * 100)}% match
                                    </span>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            Sin candidatos
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {row.matched_company_id && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleConfirm(row, row.matched_company_id!)}
                              disabled={isProcessing}
                            >
                              {isProcessing ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <Check className="size-4" />
                              )}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleIgnore(row.id)}
                            disabled={isProcessing}
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
