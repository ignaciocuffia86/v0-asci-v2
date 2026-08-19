"use client"

import { useCallback, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useDropzone } from "react-dropzone"
import { upload } from "@vercel/blob/client"
import {
  AlertCircle,
  ArrowRight,
  CheckCircle,
  Download,
  FileUp,
  Loader2,
  Search,
  Upload,
  Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { ACCOUNT_IMPORT_TEMPLATE_CSV } from "@/lib/v3/services/account-import-parse"
import {
  confirmAccountImportAction,
  createAccountImportAction,
  discardAccountImportAction,
  getAccountImportAction,
  getImportPreflightAction,
  listBookmarkTargetUsersAction,
  resolveImportRowAction,
  searchCompaniesForImportAction,
  type WorkspaceOption,
} from "@/app/actions/v3/account-imports"
import type {
  AccountImportRow,
  AccountImportSummary,
  BookmarkTargetUser,
  ConfirmImportResult,
  ImportPreflight,
  ImportRowCandidate,
} from "@/lib/v3/services/account-import"

const STATUS_META: Record<string, { label: string; badge: "default" | "secondary" | "destructive" | "outline" }> = {
  matched: { label: "Match directo", badge: "default" },
  candidate: { label: "Candidato", badge: "secondary" },
  ambiguous: { label: "Ambiguo", badge: "secondary" },
  not_found: { label: "No encontrada", badge: "outline" },
  already_followed: { label: "Ya seguida", badge: "outline" },
  error: { label: "Error", badge: "destructive" },
}

interface AccountImportWizardProps {
  workspaces: WorkspaceOption[]
  recentImports: Array<AccountImportSummary & { workspaceName: string }>
  initialWorkspaceId: string | null
  loadError?: string
}

export function AccountImportWizard({
  workspaces,
  recentImports,
  initialWorkspaceId,
  loadError,
}: AccountImportWizardProps) {
  const router = useRouter()
  const { toast } = useToast()

  const [step, setStep] = useState<"setup" | "review" | "result">("setup")
  const [workspaceId, setWorkspaceId] = useState<string | null>(
    initialWorkspaceId && workspaces.some((w) => w.id === initialWorkspaceId) ? initialWorkspaceId : null,
  )
  const [file, setFile] = useState<File | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [parseWarnings, setParseWarnings] = useState<string[]>([])

  const [summary, setSummary] = useState<AccountImportSummary | null>(null)
  const [rows, setRows] = useState<AccountImportRow[]>([])
  const [preflight, setPreflight] = useState<ImportPreflight | null>(null)
  const [busyRowId, setBusyRowId] = useState<string | null>(null)

  // Puente a bookmarks v2
  const [v2Enabled, setV2Enabled] = useState(false)
  const [v2Users, setV2Users] = useState<BookmarkTargetUser[]>([])
  const [v2Selected, setV2Selected] = useState<Set<string>>(new Set())
  const [v2Filter, setV2Filter] = useState("")
  const [v2Loading, setV2Loading] = useState(false)

  // Búsqueda manual de empresa para una fila
  const [searchRow, setSearchRow] = useState<AccountImportRow | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<ImportRowCandidate[]>([])
  const [searching, setSearching] = useState(false)

  const [isConfirming, setIsConfirming] = useState(false)
  const [result, setResult] = useState<ConfirmImportResult | null>(null)

  const selectedWorkspace = workspaces.find((w) => w.id === workspaceId) ?? null

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted.length > 0) setFile(accepted[0])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
    },
    maxFiles: 1,
  })

  const refreshImport = useCallback(
    async (importId: string) => {
      const [data, pf] = await Promise.all([
        getAccountImportAction(importId),
        getImportPreflightAction(importId),
      ])
      if ("error" in data) {
        toast({ title: "Error", description: data.error, variant: "destructive" })
        return
      }
      setSummary(data.summary)
      setRows(data.rows)
      if (!("error" in pf)) setPreflight(pf)
    },
    [toast],
  )

  const downloadTemplate = () => {
    const blob = new Blob([ACCOUNT_IMPORT_TEMPLATE_CSV], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "template-cuentas-asci.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  const processFile = async () => {
    if (!file || !workspaceId) return
    setIsProcessing(true)
    setParseWarnings([])
    try {
      const uniquePath = `${crypto.randomUUID()}-${file.name}`
      const blob = await upload(uniquePath, file, {
        access: "public",
        handleUploadUrl: "/api/v3/account-imports/blob-upload",
      })

      const created = await createAccountImportAction({
        workspaceId,
        blobUrl: blob.url,
        filename: file.name,
      })
      if ("error" in created) {
        toast({ title: "No se pudo procesar el archivo", description: created.error, variant: "destructive" })
        return
      }

      const warnings: string[] = []
      if (created.skipped.length) {
        const sample = created.skipped
          .slice(0, 5)
          .map((s) => `fila ${s.rowNumber}: ${s.reason}`)
          .join(" · ")
        warnings.push(
          `${created.skipped.length} filas descartadas en el parseo (${sample}${created.skipped.length > 5 ? "…" : ""})`,
        )
      }
      if (created.truncated > 0) {
        warnings.push(`El archivo excede el máximo de filas: se tomaron las primeras y quedaron ${created.truncated} afuera.`)
      }
      setParseWarnings(warnings)

      await refreshImport(created.importId)
      setStep("review")
    } catch (err) {
      toast({
        title: "Error de upload",
        description: err instanceof Error ? err.message : "Intentá de nuevo",
        variant: "destructive",
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const resumeImport = async (importId: string, wsId: string) => {
    setWorkspaceId(wsId)
    setIsProcessing(true)
    try {
      await refreshImport(importId)
      setStep("review")
    } finally {
      setIsProcessing(false)
    }
  }

  const resolveRow = async (row: AccountImportRow, action: "confirm" | "create" | "ignore", companyId?: string) => {
    if (!summary) return
    setBusyRowId(row.id)
    try {
      const res = await resolveImportRowAction({ importId: summary.id, rowId: row.id, action, companyId })
      if ("error" in res) {
        toast({ title: "No se pudo resolver la fila", description: res.error, variant: "destructive" })
        return
      }
      await refreshImport(summary.id)
    } finally {
      setBusyRowId(null)
    }
  }

  const toggleV2 = async (enabled: boolean) => {
    setV2Enabled(enabled)
    if (enabled && v2Users.length === 0 && workspaceId) {
      setV2Loading(true)
      try {
        const { users, error } = await listBookmarkTargetUsersAction(workspaceId)
        if (error) toast({ title: "Error", description: error, variant: "destructive" })
        setV2Users(users)
        // Atajo: los miembros del workspace destino arrancan preseleccionados
        setV2Selected(new Set(users.filter((u) => u.isWorkspaceMember).map((u) => u.userId)))
      } finally {
        setV2Loading(false)
      }
    }
  }

  const runCompanySearch = async (query: string) => {
    setSearchQuery(query)
    if (query.trim().length < 3) {
      setSearchResults([])
      return
    }
    setSearching(true)
    try {
      const { companies } = await searchCompaniesForImportAction(query)
      setSearchResults(companies)
    } finally {
      setSearching(false)
    }
  }

  const confirmImport = async () => {
    if (!summary) return
    setIsConfirming(true)
    try {
      const res = await confirmAccountImportAction({
        importId: summary.id,
        v2UserIds: v2Enabled ? [...v2Selected] : [],
      })
      if ("error" in res) {
        toast({ title: "No se pudo confirmar", description: res.error, variant: "destructive" })
        await refreshImport(summary.id)
        return
      }
      setResult(res)
      setStep("result")
      router.refresh()
    } finally {
      setIsConfirming(false)
    }
  }

  const discardImport = async () => {
    if (!summary) return
    await discardAccountImportAction(summary.id)
    setSummary(null)
    setRows([])
    setPreflight(null)
    setFile(null)
    setStep("setup")
    router.refresh()
  }

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rows) {
      const key = row.resolution === "ignored" ? "ignored" : row.matchStatus
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [rows])

  const filteredV2Users = useMemo(() => {
    const filter = v2Filter.trim().toLowerCase()
    if (!filter) return v2Users
    return v2Users.filter(
      (u) => u.email?.toLowerCase().includes(filter) || u.fullName?.toLowerCase().includes(filter),
    )
  }, [v2Users, v2Filter])

  // ── Paso 1: setup ──────────────────────────────────────────

  if (step === "setup") {
    const reviewable = recentImports.filter((imp) => imp.status === "reviewing")
    return (
      <div className="flex flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold text-foreground text-balance">Importar cuentas</h1>
            <p className="text-sm text-muted-foreground">
              Subí un CSV o XLSX con nombres de empresas para darlas de alta como cuentas seguidas de un
              workspace.
            </p>
          </div>
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="size-4" />
            Descargar plantilla
          </Button>
        </header>

        {loadError && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Workspace destino</CardTitle>
            <CardDescription>Las cuentas del archivo se siguen para este tenant.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Select value={workspaceId ?? undefined} onValueChange={setWorkspaceId}>
              <SelectTrigger className="w-full max-w-md" aria-label="Workspace destino">
                <SelectValue placeholder="Elegí un workspace…" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>
                    {ws.name} · {ws.plan} · {ws.followedCount} seguidas
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div
              {...getRootProps()}
              className={`cursor-pointer rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
                isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
              }`}
            >
              <input {...getInputProps()} />
              <div className="flex flex-col items-center gap-2">
                <Upload className="size-10 text-muted-foreground" />
                {file ? (
                  <div className="text-sm font-medium">
                    <p className="text-primary">{file.name}</p>
                    <p className="text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    <p>Arrastrá el archivo acá, o hacé clic para elegirlo</p>
                    <p>.csv o .xlsx — máximo 500 filas</p>
                  </div>
                )}
              </div>
            </div>

            <Button
              onClick={processFile}
              disabled={!file || !workspaceId || isProcessing}
              className="w-full max-w-md self-start"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Matcheando contra el catálogo…
                </>
              ) : (
                <>
                  <FileUp className="size-4" />
                  Procesar archivo
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {reviewable.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Imports en revisión</CardTitle>
              <CardDescription>Retomá una carga que quedó a mitad de camino.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  {reviewable.map((imp) => (
                    <TableRow key={imp.id}>
                      <TableCell className="font-medium">{imp.filename}</TableCell>
                      <TableCell className="text-muted-foreground">{imp.workspaceName}</TableCell>
                      <TableCell className="text-muted-foreground">{imp.totalRows} filas</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => resumeImport(imp.id, imp.workspaceId)}
                          disabled={isProcessing}
                        >
                          Retomar
                          <ArrowRight className="size-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    )
  }

  // ── Paso 3: resultado ──────────────────────────────────────

  if (step === "result" && result) {
    return (
      <div className="flex flex-col gap-6">
        <Alert className="border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-300">
          <CheckCircle className="size-4" />
          <AlertTitle>Import completado</AlertTitle>
          <AlertDescription>
            {result.followed} cuentas quedaron seguidas en {selectedWorkspace?.name ?? "el workspace"}.
          </AlertDescription>
        </Alert>

        <Card>
          <CardContent className="grid grid-cols-2 gap-4 py-6 md:grid-cols-4">
            <Stat label="Cuentas seguidas" value={result.followed} />
            <Stat label="Empresas creadas" value={result.createdCompanies} />
            <Stat label="Filas salteadas" value={result.skipped} />
            <Stat label="Con error" value={result.failed} />
          </CardContent>
        </Card>

        {result.v2Bookmarks.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="size-4 text-muted-foreground" />
                Bookmarks v2 creados
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuario</TableHead>
                    <TableHead>Creados</TableHead>
                    <TableHead>Ya existían</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.v2Bookmarks.map((b) => (
                    <TableRow key={b.userId}>
                      <TableCell>{b.email ?? b.userId.slice(0, 8)}</TableCell>
                      <TableCell>{b.created}</TableCell>
                      <TableCell className="text-muted-foreground">{b.alreadyExisted}</TableCell>
                      <TableCell className="text-destructive">{b.error ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-3">
          <Button asChild>
            <Link href="/v3/accounts">Ver cuentas seguidas</Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setStep("setup")
              setFile(null)
              setSummary(null)
              setRows([])
              setResult(null)
              setV2Enabled(false)
              setV2Selected(new Set())
            }}
          >
            Importar otro archivo
          </Button>
        </div>
      </div>
    )
  }

  // ── Paso 2: review ─────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground text-balance">
          Revisión: {summary?.filename}
        </h1>
        <p className="text-sm text-muted-foreground">
          Workspace destino: <span className="font-medium text-foreground">{selectedWorkspace?.name}</span> ·{" "}
          {summary?.totalRows} filas
        </p>
      </header>

      {parseWarnings.map((warning) => (
        <Alert key={warning}>
          <AlertCircle className="size-4" />
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      ))}

      <div className="flex flex-wrap gap-2">
        {Object.entries(STATUS_META).map(([status, meta]) =>
          statusCounts.get(status) ? (
            <Badge key={status} variant={meta.badge}>
              {meta.label}: {statusCounts.get(status)}
            </Badge>
          ) : null,
        )}
        {statusCounts.get("ignored") ? (
          <Badge variant="outline">Ignoradas: {statusCounts.get("ignored")}</Badge>
        ) : null}
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Archivo</TableHead>
                <TableHead>Match</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const meta = STATUS_META[row.matchStatus] ?? STATUS_META.error
                const ignored = row.resolution === "ignored"
                const busy = busyRowId === row.id
                return (
                  <TableRow key={row.id} className={ignored ? "opacity-45" : undefined}>
                    <TableCell className="text-muted-foreground">{row.rowNumber}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{row.data.company_name}</span>
                        <span className="text-xs text-muted-foreground">
                          {[row.data.country, row.data.website, row.data.linkedin_url ? "LinkedIn ✓" : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.matchedCompanyName ? (
                        <div className="flex flex-col">
                          <span>{row.matchedCompanyName}</span>
                          {row.matchScore !== null && (
                            <span className="text-xs text-muted-foreground">confianza {Math.round(row.matchScore)}</span>
                          )}
                        </div>
                      ) : row.matchStatus === "ambiguous" || row.matchStatus === "candidate" ? (
                        <Select
                          disabled={busy || ignored}
                          onValueChange={(companyId) => resolveRow(row, "confirm", companyId)}
                        >
                          <SelectTrigger className="h-8 w-56 text-xs" aria-label={`Candidatos para ${row.data.company_name}`}>
                            <SelectValue placeholder={`${row.candidates.length} candidatos…`} />
                          </SelectTrigger>
                          <SelectContent>
                            {row.candidates.map((c) => (
                              <SelectItem key={c.companyId} value={c.companyId} className="text-xs">
                                {c.name} {c.country ? `(${c.country})` : ""} · {c.confidence}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={meta.badge}>{meta.label}</Badge>
                      {row.resolution && row.resolution !== "ignored" && (
                        <Badge variant="outline" className="ml-1">
                          {row.resolution === "created" ? "creada" : "confirmada"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {busy && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                        {row.matchStatus === "not_found" && !row.resolution && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy || (!row.data.linkedin_url && !row.data.website)}
                            title={
                              !row.data.linkedin_url && !row.data.website
                                ? "Para crear la empresa la fila necesita LinkedIn o website"
                                : undefined
                            }
                            onClick={() => resolveRow(row, "create")}
                          >
                            Crear empresa
                          </Button>
                        )}
                        {!ignored && !row.resolution && row.matchStatus !== "already_followed" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              setSearchRow(row)
                              setSearchQuery(row.data.company_name)
                              runCompanySearch(row.data.company_name)
                            }}
                            aria-label={`Buscar manualmente para ${row.data.company_name}`}
                          >
                            <Search className="size-3.5" />
                          </Button>
                        )}
                        {!ignored && row.matchStatus !== "already_followed" && (
                          <Button variant="ghost" size="sm" disabled={busy} onClick={() => resolveRow(row, "ignore")}>
                            Ignorar
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Preflight de cuota */}
      {preflight && (
        <Card className={preflight.exceedsQuota ? "border-destructive/40" : undefined}>
          <CardHeader>
            <CardTitle className="text-base">Antes de confirmar</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stat label="Cuentas nuevas a seguir" value={preflight.newFollowCompanies} />
              <Stat label="Ya seguidas" value={preflight.alreadyFollowed} />
              <Stat label="Pendientes de revisión" value={preflight.pendingReview} />
              <Stat
                label={`Cupo (${selectedWorkspace?.plan ?? "plan"})`}
                value={`${preflight.quotaUsed + preflight.newFollowCompanies}/${preflight.quotaCap}`}
              />
            </div>

            {preflight.exceedsQuota && (
              <Alert variant="destructive">
                <AlertCircle className="size-4" />
                <AlertTitle>El alta excede el cupo del plan</AlertTitle>
                <AlertDescription>
                  Quedan {preflight.quotaAvailable} lugares y el archivo pide {preflight.newFollowCompanies}.
                  Ignorá filas, o ajustá el plan del workspace en{" "}
                  <Link href="/v3/admin/workspaces" className="underline">
                    Workspaces
                  </Link>{" "}
                  y volvé a confirmar.
                </AlertDescription>
              </Alert>
            )}

            {preflight.pendingReview > 0 && (
              <p className="text-sm text-muted-foreground">
                Las {preflight.pendingReview} filas sin resolver no participan del alta: confirmalas, crealas o
                ignoralas si querés incluirlas.
              </p>
            )}

            {/* Puente a bookmarks v2 */}
            <div className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="v2-bridge"
                  checked={v2Enabled}
                  onCheckedChange={(checked) => toggleV2(checked === true)}
                />
                <Label htmlFor="v2-bridge" className="cursor-pointer">
                  Crear también bookmarks v2 para usuarios seleccionados
                </Label>
              </div>
              {v2Enabled && (
                <div className="flex flex-col gap-2">
                  <Input
                    placeholder="Filtrar usuarios por email o nombre…"
                    value={v2Filter}
                    onChange={(e) => setV2Filter(e.target.value)}
                    className="max-w-sm"
                  />
                  {v2Loading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" /> Cargando usuarios…
                    </div>
                  ) : (
                    <ScrollArea className="h-48 rounded-md border">
                      <div className="flex flex-col gap-1 p-2">
                        {filteredV2Users.map((user) => (
                          <label
                            key={user.userId}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted"
                          >
                            <Checkbox
                              checked={v2Selected.has(user.userId)}
                              onCheckedChange={(checked) => {
                                setV2Selected((prev) => {
                                  const next = new Set(prev)
                                  if (checked === true) next.add(user.userId)
                                  else next.delete(user.userId)
                                  return next
                                })
                              }}
                            />
                            <span className="flex-1 truncate">
                              {user.email ?? user.userId.slice(0, 8)}
                              {user.fullName ? ` · ${user.fullName}` : ""}
                            </span>
                            {user.isWorkspaceMember && <Badge variant="secondary">miembro</Badge>}
                          </label>
                        ))}
                        {filteredV2Users.length === 0 && (
                          <p className="p-2 text-sm text-muted-foreground">Sin resultados.</p>
                        )}
                      </div>
                    </ScrollArea>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {v2Selected.size} usuarios seleccionados. Es un alta única al confirmar: no sincroniza con
                    el kanban después.
                  </p>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <Button
                onClick={confirmImport}
                disabled={isConfirming || preflight.exceedsQuota || preflight.newFollowCompanies === 0}
              >
                {isConfirming ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Dando de alta…
                  </>
                ) : (
                  `Dar de alta ${preflight.newFollowCompanies} cuentas`
                )}
              </Button>
              <Button variant="outline" onClick={discardImport} disabled={isConfirming}>
                Descartar import
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dialog de búsqueda manual */}
      <Dialog open={!!searchRow} onOpenChange={(open) => !open && setSearchRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Buscar empresa</DialogTitle>
            <DialogDescription>
              Asignar manualmente la empresa correcta para “{searchRow?.data.company_name}”.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              value={searchQuery}
              onChange={(e) => runCompanySearch(e.target.value)}
              placeholder="Nombre o dominio…"
              autoFocus
            />
            {searching ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Buscando…
              </div>
            ) : (
              <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                {searchResults.map((c) => (
                  <Button
                    key={c.companyId}
                    variant="ghost"
                    className="justify-start"
                    onClick={async () => {
                      const row = searchRow
                      setSearchRow(null)
                      if (row) await resolveRow(row, "confirm", c.companyId)
                    }}
                  >
                    <span className="truncate">
                      {c.name}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {[c.country, c.website].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </Button>
                ))}
                {searchResults.length === 0 && searchQuery.trim().length >= 3 && (
                  <p className="p-2 text-sm text-muted-foreground">Sin resultados en el catálogo.</p>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xl font-semibold text-foreground">{value}</span>
      <span className="text-xs uppercase text-muted-foreground">{label}</span>
    </div>
  )
}
