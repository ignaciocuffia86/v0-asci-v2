"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Download,
  Search,
  Loader2,
  Filter,
  X,
  Briefcase,
  Building2,
  CalendarDays,
  MapPin,
  Signal,
  Database,
  ExternalLink,
  AlertTriangle,
} from "lucide-react"
import {
  getJobDictionaryProcesses,
  getJobDictionaryTechnologies,
  getJobCountries,
  getJobIndustries,
  getJobExportStats,
  previewJobExport,
  type JobExportFilters,
  type JobExportRow,
  type DictionaryEntry,
  type JobExportStats,
} from "@/app/actions/job-posting-export"

type SignalTypeOption = "all" | "process" | "technology"

export default function ExportJobPostingsPage() {
  // Opciones de los filtros
  const [processes, setProcesses] = useState<DictionaryEntry[]>([])
  const [technologies, setTechnologies] = useState<DictionaryEntry[]>([])
  const [countries, setCountries] = useState<{ country: string; job_count: number }[]>([])
  const [industries, setIndustries] = useState<{ industry: string; job_count: number }[]>([])
  const [stats, setStats] = useState<JobExportStats | null>(null)
  const [isLoadingOptions, setIsLoadingOptions] = useState(true)

  // Estado de los filtros
  const [signalType, setSignalType] = useState<SignalTypeOption>("all")
  const [selectedSignalNames, setSelectedSignalNames] = useState<string[]>([])
  const [selectedCountries, setSelectedCountries] = useState<string[]>([])
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([])
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [locationQuery, setLocationQuery] = useState("")
  const [titleQuery, setTitleQuery] = useState("")
  const [onlyWithSignals, setOnlyWithSignals] = useState(false)
  const [includeDescription, setIncludeDescription] = useState(false)

  // Resultados
  const [results, setResults] = useState<JobExportRow[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    const loadOptions = async () => {
      try {
        const [procs, techs, ctrs, inds, st] = await Promise.all([
          getJobDictionaryProcesses(),
          getJobDictionaryTechnologies(),
          getJobCountries(),
          getJobIndustries(),
          getJobExportStats(),
        ])
        setProcesses(procs)
        setTechnologies(techs)
        setCountries(ctrs)
        setIndustries(inds)
        setStats(st)
      } catch (error) {
        console.error("[v0] Error cargando opciones:", error)
      } finally {
        setIsLoadingOptions(false)
      }
    }
    loadOptions()
  }, [])

  const buildFilters = useCallback(
    (): JobExportFilters => ({
      signalType: signalType === "all" ? null : signalType,
      signalNames: selectedSignalNames,
      countries: selectedCountries,
      industries: selectedIndustries,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      locationQuery: locationQuery || null,
      titleQuery: titleQuery || null,
      onlyWithSignals,
      includeDescription,
    }),
    [
      signalType,
      selectedSignalNames,
      selectedCountries,
      selectedIndustries,
      dateFrom,
      dateTo,
      locationQuery,
      titleQuery,
      onlyWithSignals,
      includeDescription,
    ],
  )

  const activeFilterCount = useMemo(
    () =>
      (signalType !== "all" ? 1 : 0) +
      selectedSignalNames.length +
      selectedCountries.length +
      selectedIndustries.length +
      (dateFrom ? 1 : 0) +
      (dateTo ? 1 : 0) +
      (locationQuery ? 1 : 0) +
      (titleQuery ? 1 : 0) +
      (onlyWithSignals ? 1 : 0),
    [
      signalType,
      selectedSignalNames,
      selectedCountries,
      selectedIndustries,
      dateFrom,
      dateTo,
      locationQuery,
      titleQuery,
      onlyWithSignals,
    ],
  )

  const hasFilters = activeFilterCount > 0

  const handleSearch = useCallback(async () => {
    setIsLoading(true)
    setHasSearched(true)
    setErrorMsg(null)

    try {
      const { data, total, error } = await previewJobExport(buildFilters())
      setResults(data)
      setTotalCount(total)
      if (error) setErrorMsg(error)
    } catch (error) {
      console.error("[v0] Error buscando jobpostings:", error)
      setErrorMsg((error as Error).message)
      setResults([])
      setTotalCount(0)
    } finally {
      setIsLoading(false)
    }
  }, [buildFilters])

  /**
   * El export navega al route handler, que devuelve el CSV como stream.
   * Así el browser maneja la descarga nativamente y soporta los 35k+ registros
   * sin límite de memoria ni de payload.
   */
  const handleExport = useCallback(
    (ignoreFilters = false) => {
      const params = new URLSearchParams()

      if (!ignoreFilters) {
        const f = buildFilters()
        if (f.signalType) params.set("signalType", f.signalType)
        if (f.signalNames.length) params.set("signalNames", f.signalNames.join(","))
        if (f.countries.length) params.set("countries", f.countries.join(","))
        if (f.industries.length) params.set("industries", f.industries.join(","))
        if (f.dateFrom) params.set("dateFrom", f.dateFrom)
        if (f.dateTo) params.set("dateTo", f.dateTo)
        if (f.locationQuery) params.set("locationQuery", f.locationQuery)
        if (f.titleQuery) params.set("titleQuery", f.titleQuery)
        if (f.onlyWithSignals) params.set("onlyWithSignals", "true")
      }
      if (includeDescription) params.set("includeDescription", "true")

      setIsExporting(true)
      window.location.href = `/api/admin/export/job-postings?${params.toString()}`

      // No hay evento de "descarga terminada" para una navegación de este tipo,
      // así que se libera el botón después de un margen razonable.
      setTimeout(() => setIsExporting(false), 3000)
    },
    [buildFilters, includeDescription],
  )

  const clearFilters = () => {
    setSignalType("all")
    setSelectedSignalNames([])
    setSelectedCountries([])
    setSelectedIndustries([])
    setDateFrom("")
    setDateTo("")
    setLocationQuery("")
    setTitleQuery("")
    setOnlyWithSignals(false)
    setResults([])
    setHasSearched(false)
    setTotalCount(0)
    setErrorMsg(null)
  }

  const toggle = (value: string, list: string[], setter: (v: string[]) => void) => {
    setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
  }

  const signalOptions = useMemo(() => {
    if (signalType === "process") return processes
    if (signalType === "technology") return technologies
    return [...processes, ...technologies].sort((a, b) => a.name.localeCompare(b.name, "es"))
  }, [signalType, processes, technologies])

  const formatNum = (n: number) => n.toLocaleString("es-AR")

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Briefcase className="h-6 w-6" />
          Export de Jobpostings
        </h1>
        <p className="text-muted-foreground">
          Exporta avisos de trabajo a CSV, filtrando por fecha de posteo, país, industria y señales del diccionario.
        </p>
      </header>

      {/* Panorama de datos disponibles */}
      {stats && (
        <Card>
          <CardContent className="flex flex-wrap gap-x-8 gap-y-4 pt-6">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total jobpostings</p>
              <p className="text-2xl font-bold">{formatNum(stats.total_jobs)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Con señales</p>
              <p className="text-2xl font-bold">{formatNum(stats.with_signals)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Con país</p>
              <p className="text-2xl font-bold">{formatNum(stats.with_country)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Empresas</p>
              <p className="text-2xl font-bold">{formatNum(stats.companies)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Rango de fechas</p>
              <p className="text-sm font-medium pt-2">
                {stats.date_min} &rarr; {stats.date_max}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Exportar todo */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-5 w-5" />
            Exportar todo
          </CardTitle>
          <CardDescription>
            Descarga los {stats ? formatNum(stats.total_jobs) : ""} jobpostings completos, sin aplicar ningún filtro.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" onClick={() => handleExport(true)} disabled={isExporting}>
            {isExporting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Exportar todos los jobpostings
          </Button>
        </CardContent>
      </Card>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Filtros
                {hasFilters && <Badge variant="secondary">{activeFilterCount} activos</Badge>}
              </CardTitle>
              <CardDescription>Todos los filtros son opcionales y se combinan entre sí.</CardDescription>
            </div>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4 mr-1" />
                Limpiar
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Fecha de posteo + busquedas de texto */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" />
                Fecha de posteo (desde)
              </Label>
              <Input
                type="date"
                value={dateFrom}
                min={stats?.date_min ?? undefined}
                max={stats?.date_max ?? undefined}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" />
                Fecha de posteo (hasta)
              </Label>
              <Input
                type="date"
                value={dateTo}
                min={stats?.date_min ?? undefined}
                max={stats?.date_max ?? undefined}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <Briefcase className="h-3.5 w-3.5" />
                Título del aviso contiene
              </Label>
              <Input
                placeholder="Ej: Developer, Analista SAP..."
                value={titleQuery}
                onChange={(e) => setTitleQuery(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                Ubicación contiene
              </Label>
              <Input
                placeholder="Ej: Buenos Aires, Santiago, Remote..."
                value={locationQuery}
                onChange={(e) => setLocationQuery(e.target.value)}
              />
            </div>
          </div>

          <Separator />

          {/* Señales */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <Signal className="h-3.5 w-3.5" />
                Tipo de señal
              </Label>
              <Select
                value={signalType}
                onValueChange={(v) => {
                  setSignalType(v as SignalTypeOption)
                  setSelectedSignalNames([])
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Procesos y tecnologías</SelectItem>
                  <SelectItem value="process">Solo procesos</SelectItem>
                  <SelectItem value="technology">Solo tecnologías</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Señales del diccionario</Label>
              <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto border rounded-lg p-3 bg-muted/30">
                {isLoadingOptions ? (
                  <p className="text-sm text-muted-foreground">Cargando señales...</p>
                ) : signalOptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin señales disponibles</p>
                ) : (
                  signalOptions.map((item) => (
                    <Badge
                      key={`${item.id}-${item.name}`}
                      variant={selectedSignalNames.includes(item.name) ? "default" : "outline"}
                      className="cursor-pointer transition-colors"
                      onClick={() => toggle(item.name, selectedSignalNames, setSelectedSignalNames)}
                    >
                      {item.name}
                    </Badge>
                  ))
                )}
              </div>
              {selectedSignalNames.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Trae jobpostings que tengan cualquiera de las {selectedSignalNames.length} señales seleccionadas.
                </p>
              )}
            </div>
          </div>

          <Separator />

          {/* Paises */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              Países
            </Label>
            <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto border rounded-lg p-3 bg-muted/30">
              {isLoadingOptions ? (
                <p className="text-sm text-muted-foreground">Cargando países...</p>
              ) : (
                countries.map(({ country, job_count }) => (
                  <Badge
                    key={country}
                    variant={selectedCountries.includes(country) ? "default" : "outline"}
                    className="cursor-pointer transition-colors"
                    onClick={() => toggle(country, selectedCountries, setSelectedCountries)}
                  >
                    {country}
                    <span className="ml-1.5 opacity-60">{formatNum(job_count)}</span>
                  </Badge>
                ))
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              El país se toma de la empresa del aviso. Para filtrar por ciudad o región usá &quot;Ubicación
              contiene&quot;.
            </p>
          </div>

          {/* Industrias */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              <Building2 className="h-3.5 w-3.5" />
              Industrias
            </Label>
            <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto border rounded-lg p-3 bg-muted/30">
              {isLoadingOptions ? (
                <p className="text-sm text-muted-foreground">Cargando industrias...</p>
              ) : (
                industries.map(({ industry, job_count }) => (
                  <Badge
                    key={industry}
                    variant={selectedIndustries.includes(industry) ? "default" : "outline"}
                    className="cursor-pointer transition-colors"
                    onClick={() => toggle(industry, selectedIndustries, setSelectedIndustries)}
                  >
                    {industry}
                    <span className="ml-1.5 opacity-60">{formatNum(job_count)}</span>
                  </Badge>
                ))
              )}
            </div>
          </div>

          <Separator />

          {/* Opciones */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="only-with-signals"
                checked={onlyWithSignals}
                onCheckedChange={(c) => setOnlyWithSignals(c === true)}
              />
              <Label htmlFor="only-with-signals" className="text-sm cursor-pointer font-normal">
                Solo jobpostings que tengan al menos una señal
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="include-description"
                checked={includeDescription}
                onCheckedChange={(c) => setIncludeDescription(c === true)}
                className="mt-0.5"
              />
              <div>
                <Label htmlFor="include-description" className="text-sm cursor-pointer font-normal">
                  Incluir la descripción completa del aviso
                </Label>
                <p className="text-xs text-muted-foreground">
                  Las descripciones promedian 3.100 caracteres. Incluirlas en un export completo genera un archivo de
                  más de 100 MB.
                </p>
              </div>
            </div>
          </div>

          {/* Acciones */}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={handleSearch} disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Search className="h-4 w-4 mr-2" />
              )}
              Buscar
            </Button>
            <Button variant="outline" onClick={() => handleExport(false)} disabled={isExporting || totalCount === 0}>
              {isExporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Exportar filtrados {totalCount > 0 && `(${formatNum(totalCount)})`}
            </Button>
          </div>
        </CardContent>
      </Card>

      {errorMsg && (
        <Card className="border-destructive/50">
          <CardContent className="flex items-start gap-2 pt-6">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            <div>
              <p className="font-medium">Error al consultar</p>
              <p className="text-sm text-muted-foreground">{errorMsg}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Preview */}
      {hasSearched && !errorMsg && (
        <Card>
          <CardHeader>
            <CardTitle>
              {totalCount > 0 ? `${formatNum(totalCount)} jobpostings encontrados` : "Sin resultados"}
            </CardTitle>
            {results.length > 0 && (
              <CardDescription>
                Preview de los primeros {results.length}, ordenados por fecha de posteo descendente. El CSV va a
                contener los {formatNum(totalCount)} registros.
              </CardDescription>
            )}
          </CardHeader>
          {results.length > 0 && (
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[220px]">Título</TableHead>
                      <TableHead className="min-w-[160px]">Empresa</TableHead>
                      <TableHead>País</TableHead>
                      <TableHead className="min-w-[140px]">Ubicación</TableHead>
                      <TableHead>Posteo</TableHead>
                      <TableHead className="text-center">Señales</TableHead>
                      <TableHead className="min-w-[200px]">Detalle de señales</TableHead>
                      <TableHead className="text-center">Link</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((row) => {
                      const signalDetail = [row.signals_process, row.signals_technology]
                        .filter(Boolean)
                        .join("; ")
                      return (
                        <TableRow key={row.job_id}>
                          <TableCell className="font-medium">{row.title || "-"}</TableCell>
                          <TableCell className="text-sm">{row.company_name || "-"}</TableCell>
                          <TableCell className="text-sm">{row.country || "-"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{row.location || "-"}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            {row.posted_at ? String(row.posted_at).slice(0, 10) : "-"}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant={row.signal_count > 0 ? "secondary" : "outline"}>{row.signal_count}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {signalDetail ? (
                              <span className="line-clamp-2">{signalDetail}</span>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {row.job_url ? (
                              <a
                                href={row.job_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline inline-flex"
                                aria-label={`Abrir aviso ${row.title ?? ""}`}
                              >
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  )
}
