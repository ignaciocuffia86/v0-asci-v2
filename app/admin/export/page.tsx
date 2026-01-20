"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Download, Building2, Globe, Linkedin, FileSpreadsheet, Loader2 } from "lucide-react"
import {
  getAvailableCountries,
  getCompaniesForExport,
  getExportStats,
  type CompanyExportFilters,
  type CompanyExportRow,
  type ExportSortBy,
} from "@/app/actions/company-export"

interface ExportStats {
  total_companies: number
  with_linkedin: number
  with_website: number
  with_industry: number
  with_country: number
  with_signals: number
  with_job_postings: number
}

export default function ExportPage() {
  const [countries, setCountries] = useState<{ country: string; count: number }[]>([])
  const [stats, setStats] = useState<ExportStats | null>(null)
  const [results, setResults] = useState<CompanyExportRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  // Filters
  const [selectedCountry, setSelectedCountry] = useState<string>("all")
  const [sortBy, setSortBy] = useState<ExportSortBy>("signals")
  const [limit, setLimit] = useState<number>(100)
  const [onlyWithoutLinkedIn, setOnlyWithoutLinkedIn] = useState(false)
  const [onlyWithoutIndustry, setOnlyWithoutIndustry] = useState(false)
  const [minSignals, setMinSignals] = useState<number>(0)

  // Load initial data
  useEffect(() => {
    async function loadInitialData() {
      const [countriesData, statsData] = await Promise.all([getAvailableCountries(), getExportStats()])
      setCountries(countriesData)
      setStats(statsData)
    }
    loadInitialData()
  }, [])

  // Search function
  const handleSearch = useCallback(async () => {
    setIsLoading(true)
    try {
      const filters: CompanyExportFilters = {
        country: selectedCountry === "all" ? null : selectedCountry,
        sortBy,
        limit,
        onlyWithoutLinkedIn,
        onlyWithoutIndustry,
        minSignals,
      }
      const { data } = await getCompaniesForExport(filters)
      setResults(data)
    } catch (error) {
      console.error("Error searching:", error)
    } finally {
      setIsLoading(false)
    }
  }, [selectedCountry, sortBy, limit, onlyWithoutLinkedIn, onlyWithoutIndustry, minSignals])

  // Export to CSV
  const handleExport = useCallback(() => {
    if (results.length === 0) return

    setIsExporting(true)

    const headers = [
      "Nombre",
      "País",
      "LinkedIn URL",
      "Website",
      "Señales Proceso",
      "Señales Tecnología",
      "Job Postings",
    ]

    const csvContent = [
      headers.join(","),
      ...results.map((row) =>
        [
          `"${(row.name || "").replace(/"/g, '""')}"`,
          `"${(row.country || "").replace(/"/g, '""')}"`,
          `"${(row.linkedin_url || "").replace(/"/g, '""')}"`,
          `"${(row.website || "").replace(/"/g, '""')}"`,
          row.signal_count_process,
          row.signal_count_technology,
          row.job_posting_count,
        ].join(",")
      ),
    ].join("\n")

    const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `companies_export_${selectedCountry === "all" ? "all" : selectedCountry}_${new Date().toISOString().split("T")[0]}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    setIsExporting(false)
  }, [results, selectedCountry])

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Export de Compañías</h1>
        <p className="text-muted-foreground mt-1">
          Exporta listados de compañías para enriquecimiento de datos externos
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{stats.total_companies.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">Total Compañías</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-green-600">{stats.with_signals.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">Con Señales</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{stats.with_linkedin.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">Con LinkedIn</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{stats.with_website.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">Con Website</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{stats.with_industry.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">Con Industry</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{stats.with_country.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">Con País</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{stats.with_job_postings.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">Con Job Postings</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Filtros de Exportación
          </CardTitle>
          <CardDescription>Configura los filtros para obtener el listado deseado</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Country Filter */}
            <div className="space-y-2">
              <Label>País</Label>
              <Select value={selectedCountry} onValueChange={setSelectedCountry}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar país" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los países</SelectItem>
                  {countries.map((c) => (
                    <SelectItem key={c.country} value={c.country}>
                      {c.country} ({c.count.toLocaleString()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Sort By */}
            <div className="space-y-2">
              <Label>Ordenar por</Label>
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as ExportSortBy)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="signals">Más señales (DESC)</SelectItem>
                  <SelectItem value="signals_asc">Menos señales (ASC)</SelectItem>
                  <SelectItem value="job_postings">Más job postings</SelectItem>
                  <SelectItem value="no_linkedin">Sin LinkedIn primero</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Limit */}
            <div className="space-y-2">
              <Label>Cantidad</Label>
              <Select value={limit.toString()} onValueChange={(v) => setLimit(parseInt(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="50">50 compañías</SelectItem>
                  <SelectItem value="100">100 compañías</SelectItem>
                  <SelectItem value="250">250 compañías</SelectItem>
                  <SelectItem value="500">500 compañías</SelectItem>
                  <SelectItem value="1000">1,000 compañías</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Min Signals */}
            <div className="space-y-2">
              <Label>Mínimo señales</Label>
              <Select value={minSignals.toString()} onValueChange={(v) => setMinSignals(parseInt(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Sin mínimo</SelectItem>
                  <SelectItem value="1">Al menos 1</SelectItem>
                  <SelectItem value="5">Al menos 5</SelectItem>
                  <SelectItem value="10">Al menos 10</SelectItem>
                  <SelectItem value="50">Al menos 50</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Checkboxes */}
          <div className="flex flex-wrap gap-6">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="no-linkedin"
                checked={onlyWithoutLinkedIn}
                onCheckedChange={(c) => setOnlyWithoutLinkedIn(c === true)}
              />
              <Label htmlFor="no-linkedin" className="text-sm cursor-pointer">
                Solo sin LinkedIn
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="no-industry"
                checked={onlyWithoutIndustry}
                onCheckedChange={(c) => setOnlyWithoutIndustry(c === true)}
              />
              <Label htmlFor="no-industry" className="text-sm cursor-pointer">
                Solo sin industria
              </Label>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button onClick={handleSearch} disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Buscando...
                </>
              ) : (
                "Buscar"
              )}
            </Button>
            <Button variant="outline" onClick={handleExport} disabled={results.length === 0 || isExporting}>
              {isExporting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Exportando...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Exportar CSV ({results.length})
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results Preview */}
      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Preview ({results.length} compañías)</CardTitle>
            <CardDescription>Mostrando primeros 10 resultados. El export incluirá todos.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empresa</TableHead>
                    <TableHead>País</TableHead>
                    <TableHead className="text-center">
                      <Linkedin className="h-4 w-4 inline" />
                    </TableHead>
                    <TableHead className="text-center">
                      <Globe className="h-4 w-4 inline" />
                    </TableHead>
                    <TableHead className="text-right">Proceso</TableHead>
                    <TableHead className="text-right">Tech</TableHead>
                    <TableHead className="text-right">Jobs</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.slice(0, 10).map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          {row.name}
                        </div>
                      </TableCell>
                      <TableCell>{row.country || "-"}</TableCell>
                      <TableCell className="text-center">
                        {row.linkedin_url ? (
                          <a
                            href={row.linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            <Linkedin className="h-4 w-4 inline" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {row.website ? (
                          <a
                            href={row.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            <Globe className="h-4 w-4 inline" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {Number(row.signal_count_process).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {Number(row.signal_count_technology).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {Number(row.job_posting_count).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
