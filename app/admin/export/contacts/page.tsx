"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
  Phone,
  Linkedin,
  Building2,
  Filter,
  X,
} from "lucide-react"
import {
  getDictionaryProcesses,
  getDictionaryTechnologies,
  getContactCountries,
  getContactIndustries,
  previewContactExport,
  exportContactsToCSV,
  type ContactExportFilters,
  type ContactExportRow,
  type DictionaryEntry,
} from "@/app/actions/contact-export"

export default function ExportContactsPage() {
  // Dropdown options
  const [processes, setProcesses] = useState<DictionaryEntry[]>([])
  const [technologies, setTechnologies] = useState<DictionaryEntry[]>([])
  const [countries, setCountries] = useState<string[]>([])
  const [industries, setIndustries] = useState<string[]>([])

  // Filter state
  const [selectedProcesses, setSelectedProcesses] = useState<string[]>([])
  const [selectedTechs, setSelectedTechs] = useState<string[]>([])
  const [selectedCountry, setSelectedCountry] = useState<string>("all")
  const [selectedIndustry, setSelectedIndustry] = useState<string>("all")
  const [searchText, setSearchText] = useState("")
  const [onlyWithEmail, setOnlyWithEmail] = useState(false)
  const [onlyWithPhone, setOnlyWithPhone] = useState(false)
  const [limit, setLimit] = useState<number>(100)

  // Results
  const [results, setResults] = useState<ContactExportRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)

  // Load filter options
  useEffect(() => {
    async function loadOptions() {
      const [procs, techs, ctrs, inds] = await Promise.all([
        getDictionaryProcesses(),
        getDictionaryTechnologies(),
        getContactCountries(),
        getContactIndustries(),
      ])
      setProcesses(procs)
      setTechnologies(techs)
      setCountries(ctrs)
      setIndustries(inds)
    }
    loadOptions()
  }, [])

  const buildFilters = useCallback((): ContactExportFilters => {
    return {
      processIds: selectedProcesses.length > 0 ? selectedProcesses : undefined,
      techIds: selectedTechs.length > 0 ? selectedTechs : undefined,
      country: selectedCountry !== "all" ? selectedCountry : null,
      industry: selectedIndustry !== "all" ? selectedIndustry : null,
      searchText: searchText.trim() || null,
      onlyWithEmail,
      onlyWithPhone,
      limit,
    }
  }, [selectedProcesses, selectedTechs, selectedCountry, selectedIndustry, searchText, onlyWithEmail, onlyWithPhone, limit])

  const handleSearch = useCallback(async () => {
    setIsLoading(true)
    setHasSearched(true)
    try {
      const { data } = await previewContactExport(buildFilters())
      setResults(data)
    } catch (error) {
      console.error("Error searching contacts:", error)
    } finally {
      setIsLoading(false)
    }
  }, [buildFilters])

  const handleExport = useCallback(async () => {
    setIsExporting(true)
    try {
      const data = await exportContactsToCSV(buildFilters())

      if (data.length === 0) return

      const headers = [
        "Nombre",
        "Apellido",
        "Nombre Completo",
        "Cargo",
        "Headline",
        "LinkedIn",
        "Email",
        "Email Tipo",
        "Email Status",
        "Email 2",
        "Telefono",
        "Telefono Tipo",
        "Telefono 2",
        "Pais",
        "Compania",
        "Industria",
        "Website Compania",
        "LinkedIn Compania",
        "Pais Compania",
        "Procesos Detectados",
        "Tecnologias Detectadas",
      ]

      const escape = (val: string | null) => `"${(val || "").replace(/"/g, '""')}"`

      const csvContent = [
        headers.join(","),
        ...data.map((row) =>
          [
            escape(row.first_name),
            escape(row.last_name),
            escape(row.full_name),
            escape(row.current_position_title),
            escape(row.headline),
            escape(row.linkedin_url),
            escape(row.email1),
            escape(row.email1_type),
            escape(row.email1_status),
            escape(row.email2),
            escape(row.phone1),
            escape(row.phone1_type),
            escape(row.phone2),
            escape(row.country),
            escape(row.company_name),
            escape(row.company_industry),
            escape(row.company_website),
            escape(row.company_linkedin),
            escape(row.company_country),
            escape(row.process_signals),
            escape(row.technology_signals),
          ].join(",")
        ),
      ].join("\n")

      const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      const dateStr = new Date().toISOString().split("T")[0]
      link.download = `contactos_export_${dateStr}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error("Error exporting:", error)
    } finally {
      setIsExporting(false)
    }
  }, [buildFilters])

  const toggleProcess = (id: string) => {
    setSelectedProcesses((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    )
  }

  const toggleTech = (id: string) => {
    setSelectedTechs((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    )
  }

  const clearFilters = () => {
    setSelectedProcesses([])
    setSelectedTechs([])
    setSelectedCountry("all")
    setSelectedIndustry("all")
    setSearchText("")
    setOnlyWithEmail(false)
    setOnlyWithPhone(false)
    setLimit(100)
    setResults([])
    setHasSearched(false)
  }

  const activeFilterCount =
    selectedProcesses.length +
    selectedTechs.length +
    (selectedCountry !== "all" ? 1 : 0) +
    (selectedIndustry !== "all" ? 1 : 0) +
    (searchText.trim() ? 1 : 0) +
    (onlyWithEmail ? 1 : 0) +
    (onlyWithPhone ? 1 : 0)

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Export de Contactos</h1>
        <p className="text-muted-foreground mt-1">
          Genera listas de contactos/leads con filtros por proceso, tecnologia, pais e industria
        </p>
      </div>

      {/* Filters */}
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
              <CardDescription>Selecciona los criterios para generar tu lista de contactos</CardDescription>
            </div>
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4 mr-1" />
                Limpiar filtros
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Search text */}
          <div className="space-y-2">
            <Label>Busqueda por texto</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nombre, cargo, empresa..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="pl-10"
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
              </div>
            </div>
          </div>

          {/* Process filter */}
          <div className="space-y-2">
            <Label>Procesos del Diccionario</Label>
            <div className="flex flex-wrap gap-2">
              {processes.map((proc) => (
                <Badge
                  key={proc.id}
                  variant={selectedProcesses.includes(proc.id) ? "default" : "outline"}
                  className="cursor-pointer transition-colors"
                  onClick={() => toggleProcess(proc.id)}
                >
                  {proc.name}
                </Badge>
              ))}
            </div>
          </div>

          {/* Technology filter */}
          <div className="space-y-2">
            <Label>Tecnologias del Diccionario</Label>
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
              {technologies.map((tech) => (
                <Badge
                  key={tech.id}
                  variant={selectedTechs.includes(tech.id) ? "default" : "outline"}
                  className="cursor-pointer transition-colors"
                  onClick={() => toggleTech(tech.id)}
                >
                  {tech.name}
                </Badge>
              ))}
            </div>
          </div>

          {/* Country + Industry + Limit */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Pais</Label>
              <Select value={selectedCountry} onValueChange={setSelectedCountry}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos los paises" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los paises</SelectItem>
                  {countries.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Industria</Label>
              <Select value={selectedIndustry} onValueChange={setSelectedIndustry}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas las industrias" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las industrias</SelectItem>
                  {industries.map((i) => (
                    <SelectItem key={i} value={i}>{i}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Cantidad de registros</Label>
              <Select value={limit.toString()} onValueChange={(v) => setLimit(parseInt(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="50">50 contactos</SelectItem>
                  <SelectItem value="100">100 contactos</SelectItem>
                  <SelectItem value="250">250 contactos</SelectItem>
                  <SelectItem value="500">500 contactos</SelectItem>
                  <SelectItem value="1000">1,000 contactos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-4 pt-6">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="with-email"
                  checked={onlyWithEmail}
                  onCheckedChange={(c) => setOnlyWithEmail(c === true)}
                />
                <Label htmlFor="with-email" className="text-sm cursor-pointer flex items-center gap-1">
                  <Mail className="h-3 w-3" /> Solo con email
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="with-phone"
                  checked={onlyWithPhone}
                  onCheckedChange={(c) => setOnlyWithPhone(c === true)}
                />
                <Label htmlFor="with-phone" className="text-sm cursor-pointer flex items-center gap-1">
                  <Phone className="h-3 w-3" /> Solo con telefono
                </Label>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
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
                  Buscar Contactos
                </>
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
                  Exportar CSV {results.length > 0 ? `(${results.length})` : ""}
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
              {results.length > 0
                ? `${results.length} contactos encontrados`
                : "Sin resultados"}
            </CardTitle>
            {results.length > 0 && (
              <CardDescription>
                Preview de los primeros 15 resultados. El CSV incluira los {results.length} registros completos.
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
                      <TableHead>Pais</TableHead>
                      <TableHead className="text-center">
                        <span className="sr-only">LinkedIn</span>
                        <Linkedin className="h-4 w-4 inline" />
                      </TableHead>
                      <TableHead className="text-center">
                        <span className="sr-only">Email</span>
                        <Mail className="h-4 w-4 inline" />
                      </TableHead>
                      <TableHead className="text-center">
                        <span className="sr-only">Telefono</span>
                        <Phone className="h-4 w-4 inline" />
                      </TableHead>
                      <TableHead className="min-w-[140px]">Procesos</TableHead>
                      <TableHead className="min-w-[140px]">Tecnologias</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.slice(0, 15).map((row, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">
                          {row.full_name || `${row.first_name || ""} ${row.last_name || ""}`.trim() || "-"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                          {row.current_position_title || "-"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Building2 className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            <span className="truncate max-w-[130px]">{row.company_name || "-"}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{row.country || row.company_country || "-"}</TableCell>
                        <TableCell className="text-center">
                          {row.linkedin_url ? (
                            <a href={row.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                              <Linkedin className="h-4 w-4 inline" />
                            </a>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {row.email1 ? (
                            <span title={row.email1}>
                              <Mail className="h-4 w-4 inline text-green-600" />
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {row.phone1 ? (
                            <span title={row.phone1}>
                              <Phone className="h-4 w-4 inline text-green-600" />
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.process_signals ? (
                            <div className="flex flex-wrap gap-1">
                              {row.process_signals.split(", ").slice(0, 2).map((p, i) => (
                                <Badge key={i} variant="secondary" className="text-xs">
                                  {p}
                                </Badge>
                              ))}
                              {row.process_signals.split(", ").length > 2 && (
                                <Badge variant="outline" className="text-xs">
                                  +{row.process_signals.split(", ").length - 2}
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.technology_signals ? (
                            <div className="flex flex-wrap gap-1">
                              {row.technology_signals.split(", ").slice(0, 2).map((t, i) => (
                                <Badge key={i} variant="secondary" className="text-xs">
                                  {t}
                                </Badge>
                              ))}
                              {row.technology_signals.split(", ").length > 2 && (
                                <Badge variant="outline" className="text-xs">
                                  +{row.technology_signals.split(", ").length - 2}
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
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
