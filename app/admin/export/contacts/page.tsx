"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Download,
  Users,
  Search,
  Loader2,
  Mail,
  Linkedin,
  Building2,
  Filter,
  X,
  FileSpreadsheet,
} from "lucide-react"
import {
  getDictionaryProcesses,
  getDictionaryTechnologies,
  getContactCountries,
  previewExport,
  exportToCSV,
  type ExportFilters,
  type ExportRow,
  type DictionaryEntry,
} from "@/app/actions/contact-export"

export default function ExportContactsPage() {
  // Dropdown options
  const [processes, setProcesses] = useState<DictionaryEntry[]>([])
  const [technologies, setTechnologies] = useState<DictionaryEntry[]>([])
  const [countries, setCountries] = useState<string[]>([])

  // Filter state
  const [signalType, setSignalType] = useState<"process" | "technology" | "all">("all")
  const [selectedSignalNames, setSelectedSignalNames] = useState<string[]>([])
  const [selectedCountries, setSelectedCountries] = useState<string[]>([])
  const [onlyCorporateEmail, setOnlyCorporateEmail] = useState(true)

  // Results
  const [results, setResults] = useState<ExportRow[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)

  // Load dropdown options on mount
  useEffect(() => {
    const loadOptions = async () => {
      const [procs, techs, ctrs] = await Promise.all([
        getDictionaryProcesses(),
        getDictionaryTechnologies(),
        getContactCountries(),
      ])
      setProcesses(procs)
      setTechnologies(techs)
      setCountries(ctrs)
    }
    loadOptions()
  }, [])

  // Build filters object
  const buildFilters = useCallback((): ExportFilters => {
    return {
      signalType: signalType === "all" ? null : signalType,
      signalNames: selectedSignalNames,
      countries: selectedCountries,
      onlyCorporateEmail,
      limit: 10000,
    }
  }, [signalType, selectedSignalNames, selectedCountries, onlyCorporateEmail])

  // Search handler
  const handleSearch = useCallback(async () => {
    if (selectedCountries.length === 0) {
      alert("Por favor selecciona al menos un país")
      return
    }

    setIsLoading(true)
    setHasSearched(true)

    try {
      const { data, total } = await previewExport(buildFilters())
      setResults(data)
      setTotalCount(total)
    } catch (error) {
      console.error("[v0] Error searching:", error)
      alert("Error al buscar: " + (error as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [buildFilters, selectedCountries])

  // Export handler
  const handleExport = useCallback(async () => {
    if (totalCount === 0) {
      alert("No hay resultados para exportar")
      return
    }

    setIsExporting(true)

    try {
      const data = await exportToCSV(buildFilters())

      if (!data.length) {
        alert("No hay datos para exportar")
        return
      }

      // Helper function to escape CSV values
      const escapeCSV = (value: string | null | undefined): string => {
        if (!value) return ""
        const str = String(value)
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      }

      // Build CSV
      const headers = [
        "Nombre",
        "Apellido",
        "Nombre Completo",
        "Cargo",
        "Empresa",
        "País",
        "LinkedIn",
        "Email",
        "Tipo de Señal",
        "Señal",
      ]

      const csvContent = [
        headers.join(","),
        ...data.map((row) =>
          [
            escapeCSV(row.first_name),
            escapeCSV(row.last_name),
            escapeCSV(row.full_name),
            escapeCSV(row.job_title),
            escapeCSV(row.company_name),
            escapeCSV(row.company_country),
            escapeCSV(row.linkedin_url),
            escapeCSV(row.email),
            escapeCSV(row.signal_type === "process" ? "Proceso" : "Tecnología"),
            escapeCSV(row.signal_name),
          ].join(",")
        ),
      ].join("\n")

      // Download
      const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      const dateStr = new Date().toISOString().split("T")[0]
      const signalLabel = selectedSignalNames.length > 0 ? `_${selectedSignalNames.join("_").replace(/\s+/g, "_")}` : ""
      link.download = `contactos_export${signalLabel}_${dateStr}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error("[v0] Error exporting:", error)
      alert("Error al exportar: " + (error as Error).message)
    } finally {
      setIsExporting(false)
    }
  }, [buildFilters, totalCount, selectedSignalNames])

  // Toggle country selection
  const toggleCountry = (country: string) => {
    setSelectedCountries((prev) =>
      prev.includes(country)
        ? prev.filter((c) => c !== country)
        : [...prev, country]
    )
  }

  const toggleSignalName = (signalName: string) => {
    setSelectedSignalNames((prev) =>
      prev.includes(signalName)
        ? prev.filter((s) => s !== signalName)
        : [...prev, signalName]
    )
  }

  const clearFilters = () => {
    setSignalType("all")
    setSelectedSignalNames([])
    setSelectedCountries([])
    setOnlyCorporateEmail(true)
    setResults([])
    setHasSearched(false)
    setTotalCount(0)
  }

  // Get current signal options based on type
  const signalOptions = signalType === "process" 
    ? processes 
    : signalType === "technology" 
    ? technologies 
    : [...processes, ...technologies].sort((a, b) => a.name.localeCompare(b.name))

  const activeFilterCount = 
    (signalType !== "all" ? 1 : 0) +
    selectedSignalNames.length +
    selectedCountries.length +
    (onlyCorporateEmail ? 0 : 1)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileSpreadsheet className="h-6 w-6" />
            Export de Contactos por Señales
          </h1>
          <p className="text-muted-foreground">
            Exporta contactos con señales de procesos o tecnologías a CSV
          </p>
        </div>
      </div>

      {/* Filters Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Filtros
                {activeFilterCount > 0 && (
                  <Badge variant="secondary">{activeFilterCount} activos</Badge>
                )}
              </CardTitle>
              <CardDescription>
                Selecciona los criterios para generar tu lista de contactos
              </CardDescription>
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
          {/* Signal Type */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tipo de Señal</Label>
              <Select value={signalType} onValueChange={(v) => {
                setSignalType(v as "process" | "technology" | "all")
                setSelectedSignalNames([]) // Reset signal names when type changes
              }}>
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

            {/* Signal Names - Multi-Select */}
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

          {/* Countries Multi-Select */}
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

          {/* Checkboxes */}
          <div className="flex flex-wrap gap-6">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="corporate-email"
                checked={onlyCorporateEmail}
                onCheckedChange={(c) => setOnlyCorporateEmail(c === true)}
              />
              <Label htmlFor="corporate-email" className="text-sm cursor-pointer flex items-center gap-1">
                <Mail className="h-3 w-3" /> Solo emails corporativos
              </Label>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2">
            <Button 
              onClick={handleSearch} 
              disabled={isLoading || selectedCountries.length === 0}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Buscando...
                </>
              ) : (
                <>
                  <Search className="h-4 w-4 mr-2" />
                  Buscar Contactos
                </>
              )}
            </Button>
            <Button 
              variant="outline" 
              onClick={handleExport} 
              disabled={totalCount === 0 || isExporting}
            >
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

      {/* Results Preview */}
      {hasSearched && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              {totalCount > 0 
                ? `${totalCount} contactos encontrados` 
                : "Sin resultados"}
            </CardTitle>
            {results.length > 0 && (
              <CardDescription>
                Preview de los primeros {results.length} resultados. El CSV contendrá todos los {totalCount} registros.
              </CardDescription>
            )}
          </CardHeader>
          {results.length > 0 && (
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[180px]">Nombre</TableHead>
                      <TableHead className="min-w-[150px]">Cargo</TableHead>
                      <TableHead className="min-w-[150px]">Empresa</TableHead>
                      <TableHead>País</TableHead>
                      <TableHead className="text-center">
                        <Linkedin className="h-4 w-4 inline" />
                      </TableHead>
                      <TableHead className="text-center">
                        <Mail className="h-4 w-4 inline" />
                      </TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="min-w-[140px]">Señal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((row, idx) => (
                      <TableRow key={`${row.contact_id}-${row.signal_name}-${idx}`}>
                        <TableCell className="font-medium">
                          {row.full_name || `${row.first_name || ""} ${row.last_name || ""}`.trim() || "-"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.job_title || "-"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Building2 className="h-3 w-3 text-muted-foreground" />
                            <span className="text-sm">{row.company_name || "-"}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.company_country || "-"}
                        </TableCell>
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
                          {row.email ? (
                            <span title={row.email}>
                              <Mail className="h-4 w-4 inline text-green-600" />
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {row.signal_type === "process" ? "Proceso" : "Tecnología"}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium text-sm">
                          {row.signal_name || "-"}
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
