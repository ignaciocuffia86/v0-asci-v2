"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Download, Building2, Loader2, Filter, Shield } from "lucide-react"
import {
  getCompaniesWithSignals,
  getSignalNamesForExport,
  getCompanyIndustries,
  getAvailableCountries,
  type CompanyWithSignalsFilters,
  type CompanyWithSignalsRow,
} from "@/app/actions/company-export"
import { Checkbox } from "@/components/ui/checkbox"

export default function CompaniesSignalsExportPage() {
  // Dropdown options
  const [processes, setProcesses] = useState<string[]>([])
  const [technologies, setTechnologies] = useState<string[]>([])
  const [countries, setCountries] = useState<string[]>([])
  const [industries, setIndustries] = useState<string[]>([])

  // Filter state
  const [signalType, setSignalType] = useState<"process" | "technology" | "all">("all")
  const [selectedSignalNames, setSelectedSignalNames] = useState<string[]>([])
  const [selectedCountries, setSelectedCountries] = useState<string[]>([])
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([])
  const [excludeServiceProviders, setExcludeServiceProviders] = useState(true)

  // Results state
  const [results, setResults] = useState<CompanyWithSignalsRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [totalCount, setTotalCount] = useState(0)

  // Load dropdown options on mount
  useEffect(() => {
    const loadOptions = async () => {
      const [procs, techs, ctrs, inds] = await Promise.all([
        getSignalNamesForExport("process"),
        getSignalNamesForExport("technology"),
        getAvailableCountries().then((c) => c.map((x) => x.country)),
        getCompanyIndustries(),
      ])
      setProcesses(procs)
      setTechnologies(techs)
      setCountries(ctrs)
      setIndustries(inds)
    }
    loadOptions()
  }, [])

  // Build filters object
  const buildFilters = useCallback((): CompanyWithSignalsFilters => {
    return {
      signalType: signalType === "all" ? null : signalType,
      signalNames: selectedSignalNames,
      countries: selectedCountries,
      industries: selectedIndustries,
      excludeServiceProviders,
      limit: 10000,
    }
  }, [signalType, selectedSignalNames, selectedCountries, selectedIndustries, excludeServiceProviders])

  // Toggle functions
  const toggleCountry = (country: string) => {
    setSelectedCountries((prev) =>
      prev.includes(country) ? prev.filter((c) => c !== country) : [...prev, country]
    )
  }

  const toggleIndustry = (industry: string) => {
    setSelectedIndustries((prev) =>
      prev.includes(industry) ? prev.filter((i) => i !== industry) : [...prev, industry]
    )
  }

  const toggleSignalName = (signalName: string) => {
    setSelectedSignalNames((prev) =>
      prev.includes(signalName) ? prev.filter((s) => s !== signalName) : [...prev, signalName]
    )
  }

  const clearFilters = () => {
    setSignalType("all")
    setSelectedSignalNames([])
    setSelectedCountries([])
    setSelectedIndustries([])
    setExcludeServiceProviders(true)
    setResults([])
    setHasSearched(false)
    setTotalCount(0)
  }

  const activeFilterCount =
    (signalType !== "all" ? 1 : 0) + selectedSignalNames.length + selectedCountries.length + selectedIndustries.length

  // Search function
  const handleSearch = useCallback(async () => {
    setIsLoading(true)
    try {
      const filters = buildFilters()
      const { data, total } = await getCompaniesWithSignals(filters)
      setResults(data)
      setTotalCount(total)
      setHasSearched(true)
    } catch (error) {
      console.error("Error searching:", error)
    } finally {
      setIsLoading(false)
    }
  }, [buildFilters])

  // Export to CSV
  const handleExport = useCallback(() => {
    if (results.length === 0) return

    setIsExporting(true)

    const headers = [
      "Nombre Compañía",
      "Website",
      "LinkedIn URL",
      "País",
      "Industria",
      "Total Señales",
      "Señales Procesos",
      "Señales Tecnologías",
      "Top Señales",
    ]

    const escapeCSV = (value: string | null | undefined) => {
      if (!value) return ""
      return `"${String(value).replace(/"/g, '""')}"`
    }

    const csvContent = [
      headers.join(","),
      ...results.map((row) => {
        const topSignals = (() => {
          try {
            const parsed = JSON.parse(row.top_signals)
            return Array.isArray(parsed) ? parsed.slice(0, 5).join("; ") : ""
          } catch {
            return row.top_signals
          }
        })()

        return [
          escapeCSV(row.company_name),
          escapeCSV(row.website),
          escapeCSV(row.linkedin_url),
          escapeCSV(row.country),
          escapeCSV(row.industry),
          row.total_signals,
          row.process_signals,
          row.technology_signals,
          escapeCSV(topSignals),
        ].join(",")
      }),
    ].join("\n")

    const blob = new Blob([csvContent], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    const dateStr = new Date().toISOString().split("T")[0]
    link.download = `companias_con_senales_${dateStr}.csv`
    link.href = url
    link.click()
    URL.revokeObjectURL(url)

    setIsExporting(false)
  }, [results])

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Export de Compañías con Señales</h1>
          <p className="mt-2 text-muted-foreground">Exporta listado de compañías con señales detectadas para usar en Apollo u otros servicios</p>
        </div>

        {/* Filters Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Filtros
              {activeFilterCount > 0 && <Badge variant="secondary">{activeFilterCount} activos</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Signal Type */}
            <div className="space-y-2">
              <Label>Tipo de Señal</Label>
              <Select value={signalType} onValueChange={(v) => {
                setSignalType(v as "process" | "technology" | "all")
                setSelectedSignalNames([])
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las señales</SelectItem>
                  <SelectItem value="process">Procesos</SelectItem>
                  <SelectItem value="technology">Tecnologías</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Signal Names */}
            <div className="space-y-2">
              <Label>Señales Específicas (opcional)</Label>
              <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto border rounded-lg p-3 bg-muted/30">
                {signalType === "all" ? (
                  <p className="text-sm text-muted-foreground">Selecciona primero un tipo de señal</p>
                ) : signalType === "process" && processes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Cargando procesos...</p>
                ) : signalType === "technology" && technologies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Cargando tecnologías...</p>
                ) : (
                  (signalType === "process" ? processes : technologies).map((item) => (
                    <Badge
                      key={item}
                      variant={selectedSignalNames.includes(item) ? "default" : "outline"}
                      className="cursor-pointer transition-colors hover:bg-primary/80"
                      onClick={() => toggleSignalName(item)}
                    >
                      {item}
                    </Badge>
                  ))
                )}
              </div>
              {selectedSignalNames.length > 0 && (
                <p className="text-xs text-muted-foreground">{selectedSignalNames.length} señal(es) seleccionada(s)</p>
              )}
            </div>

            {/* Countries */}
            <div className="space-y-2">
              <Label>Países (selecciona uno o más)</Label>
              <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto border rounded-lg p-3 bg-muted/30">
                {countries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Cargando países...</p>
                ) : (
                  countries.map((country) => (
                    <Badge
                      key={country}
                      variant={selectedCountries.includes(country) ? "default" : "outline"}
                      className="cursor-pointer transition-colors hover:bg-primary/80"
                      onClick={() => toggleCountry(country)}
                    >
                      {country}
                    </Badge>
                  ))
                )}
              </div>
              {selectedCountries.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {selectedCountries.length} país(es): {selectedCountries.join(", ")}
                </p>
              )}
            </div>

            {/* Industries */}
            <div className="space-y-2">
              <Label>Industrias (opcional)</Label>
              <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto border rounded-lg p-3 bg-muted/30">
                {industries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Cargando industrias...</p>
                ) : (
                  industries.map((industry) => (
                    <Badge
                      key={industry}
                      variant={selectedIndustries.includes(industry) ? "default" : "outline"}
                      className="cursor-pointer transition-colors hover:bg-primary/80"
                      onClick={() => toggleIndustry(industry)}
                    >
                      {industry}
                    </Badge>
                  ))
                )}
              </div>
              {selectedIndustries.length > 0 && (
                <p className="text-xs text-muted-foreground">{selectedIndustries.length} industria(s)</p>
              )}
            </div>

            {/* Checkboxes */}
            <div className="flex flex-wrap gap-6">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="exclude-providers"
                  checked={excludeServiceProviders}
                  onCheckedChange={(c) => setExcludeServiceProviders(c === true)}
                />
                <Label htmlFor="exclude-providers" className="text-sm cursor-pointer flex items-center gap-1">
                  <Shield className="h-3 w-3" /> Excluir proveedores de servicios
                </Label>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSearch} disabled={isLoading} size="lg">
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isLoading ? "Buscando..." : "Buscar Compañías"}
              </Button>
              {activeFilterCount > 0 && (
                <Button onClick={clearFilters} variant="outline" size="lg">
                  Limpiar Filtros
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        {hasSearched && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Resultados ({totalCount})</span>
                {results.length > 0 && (
                  <Button onClick={handleExport} disabled={isExporting} size="sm">
                    {isExporting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Exportando...
                      </>
                    ) : (
                      <>
                        <Download className="mr-2 h-4 w-4" />
                        Exportar CSV
                      </>
                    )}
                  </Button>
                )}
              </CardTitle>
              {results.length > 0 && (
                <CardDescription>
                  Preview de los primeros {results.length} resultados. El CSV contendrá todos los {totalCount > 10000 ? "10,000+" : totalCount} registros (máximo 10,000).
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {results.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No se encontraron compañías con los filtros especificados</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Compañía</TableHead>
                        <TableHead>País</TableHead>
                        <TableHead>Industria</TableHead>
                        <TableHead className="text-right">Señales</TableHead>
                        <TableHead className="text-right">Procesos</TableHead>
                        <TableHead className="text-right">Tecnologías</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {results.slice(0, 15).map((company) => (
                        <TableRow key={company.company_id}>
                          <TableCell className="font-medium">
                            <div>
                              <p>{company.company_name}</p>
                              {company.website && (
                                <a
                                  href={company.website}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-blue-600 hover:underline"
                                >
                                  {company.website}
                                </a>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{company.country || "-"}</TableCell>
                          <TableCell>{company.industry || "-"}</TableCell>
                          <TableCell className="text-right font-semibold">{company.total_signals}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{company.process_signals}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{company.technology_signals}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
