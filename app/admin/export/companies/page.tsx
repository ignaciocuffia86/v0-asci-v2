"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Download, Building2, Search, Loader2, Linkedin, Globe, Filter, X, FileSpreadsheet, Radar } from "lucide-react"
import {
  getDictionaryProcesses,
  getDictionaryTechnologies,
  getCompanyCountries,
  getCompanyIndustries,
  previewCompanyExport,
  exportCompaniesToCSV,
  type CompanyExportFilters,
  type CompanyExportRow,
  type DictionaryEntry,
} from "@/app/actions/company-signals-export"

export default function ExportCompaniesPage() {
  // Opciones de dropdowns
  const [processes, setProcesses] = useState<DictionaryEntry[]>([])
  const [technologies, setTechnologies] = useState<DictionaryEntry[]>([])
  const [countries, setCountries] = useState<string[]>([])
  const [industries, setIndustries] = useState<string[]>([])

  // Estado de filtros
  const [signalType, setSignalType] = useState<"process" | "technology" | "all">("all")
  const [selectedSignalNames, setSelectedSignalNames] = useState<string[]>([])
  const [selectedCountries, setSelectedCountries] = useState<string[]>([])
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([])

  // Resultados
  const [results, setResults] = useState<CompanyExportRow[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)

  useEffect(() => {
    const loadOptions = async () => {
      const [procs, techs, ctrs, inds] = await Promise.all([
        getDictionaryProcesses(),
        getDictionaryTechnologies(),
        getCompanyCountries(),
        getCompanyIndustries(),
      ])
      setProcesses(procs)
      setTechnologies(techs)
      setCountries(ctrs)
      setIndustries(inds)
    }
    loadOptions()
  }, [])

  const buildFilters = useCallback((): CompanyExportFilters => {
    return {
      signalType: signalType === "all" ? null : signalType,
      signalNames: selectedSignalNames,
      countries: selectedCountries,
      industries: selectedIndustries,
      limit: 10000,
    }
  }, [signalType, selectedSignalNames, selectedCountries, selectedIndustries])

  const handleSearch = useCallback(async () => {
    setIsLoading(true)
    setHasSearched(true)
    try {
      const { data, total } = await previewCompanyExport(buildFilters())
      setResults(data)
      setTotalCount(total)
    } catch (error) {
      console.error("[v0] Error searching companies:", error)
      alert("Error al buscar: " + (error as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [buildFilters])

  const handleExport = useCallback(async () => {
    if (totalCount === 0) {
      alert("No hay resultados para exportar")
      return
    }
    setIsExporting(true)
    try {
      const data = await exportCompaniesToCSV(buildFilters())
      if (!data.length) {
        alert("No hay datos para exportar")
        return
      }

      const escapeCSV = (value: string | number | null | undefined): string => {
        if (value === null || value === undefined) return ""
        const str = String(value)
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      }

      const headers = ["Empresa", "Industria", "País", "LinkedIn", "Web", "Total Señales"]
      const csvContent = [
        headers.join(","),
        ...data.map((row) =>
          [
            escapeCSV(row.company_name),
            escapeCSV(row.industry),
            escapeCSV(row.country),
            escapeCSV(row.linkedin_url),
            escapeCSV(row.website),
            escapeCSV(row.total_signals),
          ].join(","),
        ),
      ].join("\n")

      const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      const dateStr = new Date().toISOString().split("T")[0]
      const signalLabel =
        selectedSignalNames.length > 0 ? `_${selectedSignalNames.join("_").replace(/\s+/g, "_")}` : ""
      link.download = `empresas_export${signalLabel}_${dateStr}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error("[v0] Error exporting companies:", error)
      alert("Error al exportar: " + (error as Error).message)
    } finally {
      setIsExporting(false)
    }
  }, [buildFilters, totalCount, selectedSignalNames])

  const toggleCountry = (country: string) => {
    setSelectedCountries((prev) => (prev.includes(country) ? prev.filter((c) => c !== country) : [...prev, country]))
  }

  const toggleSignalName = (signalName: string) => {
    setSelectedSignalNames((prev) => (prev.includes(signalName) ? prev.filter((s) => s !== signalName) : [...prev, signalName]))
  }

  const toggleIndustry = (industry: string) => {
    setSelectedIndustries((prev) => (prev.includes(industry) ? prev.filter((i) => i !== industry) : [...prev, industry]))
  }

  const clearFilters = () => {
    setSignalType("all")
    setSelectedSignalNames([])
    setSelectedCountries([])
    setSelectedIndustries([])
    setResults([])
    setHasSearched(false)
    setTotalCount(0)
  }

  const activeFilterCount =
    (signalType !== "all" ? 1 : 0) + selectedSignalNames.length + selectedCountries.length + selectedIndustries.length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileSpreadsheet className="h-6 w-6" />
            Export de Empresas por Señales
          </h1>
          <p className="text-muted-foreground">
            Exporta empresas con señales de procesos o tecnologías a CSV, con el total de señales del filtro
          </p>
        </div>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Filtros
                {activeFilterCount > 0 && <Badge variant="secondary">{activeFilterCount} activos</Badge>}
              </CardTitle>
              <CardDescription>Selecciona los criterios para generar tu lista de empresas</CardDescription>
            </div>
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4 mr-1" />
                Limpiar
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Tipo de señal */}
            <div className="space-y-2">
              <Label>Tipo de Señal</Label>
              <Select
                value={signalType}
                onValueChange={(v) => {
                  setSignalType(v as "process" | "technology" | "all")
                  setSelectedSignalNames([])
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los tipos</SelectItem>
                  <SelectItem value="process">Procesos</SelectItem>
                  <SelectItem value="technology">Tecnologías</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Nombres de señal - multi-select */}
            <div className="space-y-2">
              <Label>Señales (selecciona una o más)</Label>
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
                      key={item.id}
                      variant={selectedSignalNames.includes(item.name) ? "default" : "outline"}
                      className="cursor-pointer transition-colors hover:bg-primary/80"
                      onClick={() => toggleSignalName(item.name)}
                    >
                      {item.name}
                    </Badge>
                  ))
                )}
              </div>
              {selectedSignalNames.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {selectedSignalNames.length} señal(es): {selectedSignalNames.join(", ")}
                </p>
              )}
            </div>
          </div>

          {/* Países */}
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

          {/* Industrias */}
          <div className="space-y-2">
            <Label>Industrias (selecciona una o más)</Label>
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
              <p className="text-xs text-muted-foreground">
                {selectedIndustries.length} industria(s): {selectedIndustries.join(", ")}
              </p>
            )}
          </div>

          {/* Acciones */}
          <div className="flex gap-2 pt-2">
            <Button onClick={handleSearch} disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Buscando...
                </>
              ) : (
                <>
                  <Search className="h-4 w-4 mr-2" />
                  Buscar Empresas
                </>
              )}
            </Button>
            <Button variant="outline" onClick={handleExport} disabled={totalCount === 0 || isExporting}>
              {isExporting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Exportando...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Exportar CSV {totalCount > 0 && `(${totalCount})`}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Preview de resultados */}
      {hasSearched && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {totalCount > 0 ? `${totalCount} empresas encontradas` : "Sin resultados"}
            </CardTitle>
            {results.length > 0 && (
              <CardDescription>
                Preview de las primeras {results.length}. El CSV contendrá todas las {totalCount} empresas.
              </CardDescription>
            )}
          </CardHeader>
          {results.length > 0 && (
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[200px]">Empresa</TableHead>
                      <TableHead className="min-w-[180px]">Industria</TableHead>
                      <TableHead>País</TableHead>
                      <TableHead className="text-center">
                        <Linkedin className="h-4 w-4 inline" />
                      </TableHead>
                      <TableHead className="text-center">
                        <Globe className="h-4 w-4 inline" />
                      </TableHead>
                      <TableHead className="text-right">
                        <span className="inline-flex items-center gap-1">
                          <Radar className="h-4 w-4" /> Señales
                        </span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((row) => (
                      <TableRow key={row.company_id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-1">
                            <Building2 className="h-3 w-3 text-muted-foreground" />
                            <span>{row.company_name || "-"}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.industry || "-"}</TableCell>
                        <TableCell className="text-sm">{row.country || "-"}</TableCell>
                        <TableCell className="text-center">
                          {row.linkedin_url ? (
                            <a
                              href={row.linkedin_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800"
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
                              href={row.website.startsWith("http") ? row.website : `https://${row.website}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800"
                            >
                              <Globe className="h-4 w-4 inline" />
                            </a>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary">{row.total_signals}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
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
