"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Search, Loader2, ArrowUpDown, X, ChevronDown, Cpu } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { searchByTechnology, type TechnologySearchResult, type SortOption } from "@/app/actions/search-v2"
import { IndustryFilterPostResults } from "@/components/search/industry-filter-post-results"
import { CompanyDrawer } from "@/components/company-drawer"
import { ScoringExplanation, ProvidersFilterTooltip } from "@/components/search/score-tooltip"
import { CountryMultiSelect } from "@/components/search/country-multi-select"
import BulkBookmarkButton from "./bulk-bookmark-button"
import ResultItem from "./result-item"
import { cn } from "@/lib/utils"

type TechnologyWithVendor = {
  id: string
  name: string
  vendor_name: string | null
  display_name: string
}

export function TechnologySearch() {
  const [technologies, setTechnologies] = useState<TechnologyWithVendor[]>([])
  const [selectedTechs, setSelectedTechs] = useState<string[]>([])
  const [matchMode, setMatchMode] = useState<"cualquiera" | "todas">("cualquiera")
  const [techSearchQuery, setTechSearchQuery] = useState("")
  const [techPopoverOpen, setTechPopoverOpen] = useState(false)
  const [selectedCountries, setSelectedCountries] = useState<string[]>([])
  const [results, setResults] = useState<TechnologySearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<Set<string>>(new Set())
  const [excludeProviders, setExcludeProviders] = useState(false)
  const [sortBy, setSortBy] = useState<SortOption>("relevance")
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([])
  const [displayLimit, setDisplayLimit] = useState(50)
  const supabase = createClient()

  const getTechName = (id: string) => technologies.find((t) => t.id === id)?.display_name || id

  const availableTechs = useMemo(() => {
    return technologies.filter((t) => {
      const notSelected = !selectedTechs.includes(t.id)
      const matchesSearch = t.display_name.toLowerCase().includes(techSearchQuery.toLowerCase())
      return notSelected && matchesSearch
    })
  }, [technologies, selectedTechs, techSearchQuery])

  const toggleTech = (id: string) => {
    if (selectedTechs.includes(id)) {
      setSelectedTechs(selectedTechs.filter((t) => t !== id))
    } else {
      setSelectedTechs([...selectedTechs, id])
    }
    setTechSearchQuery("")
  }

  useEffect(() => {
    const fetchTechnologies = async () => {
      const { data } = await supabase
        .from("dictionary_products")
        .select("id, name, vendor:dictionary_vendors(name)")
        .order("name")

      const transformed: TechnologyWithVendor[] = (data || []).map((tech: any) => ({
        id: tech.id,
        name: tech.name,
        vendor_name: tech.vendor?.name || null,
        display_name: tech.vendor?.name ? `${tech.vendor.name} - ${tech.name}` : tech.name,
      }))

      transformed.sort((a, b) => a.display_name.localeCompare(b.display_name))
      setTechnologies(transformed)
    }
    fetchTechnologies()
  }, [])

  const handleSearch = async () => {
    if (selectedTechs.length === 0 || selectedCountries.length === 0) return

    setIsSearching(true)
    setSelectedCompanyIds(new Set())
    setSelectedIndustries([])
    setDisplayLimit(50)
    try {
      const data = await searchByTechnology(selectedTechs, selectedCountries, excludeProviders, [], matchMode)
      setResults(data)
    } catch (error) {
      console.error(error)
    } finally {
      setIsSearching(false)
    }
  }

  const toggleCompanySelection = useCallback((companyId: string) => {
    setSelectedCompanyIds((prevSet) => {
      const newSet = new Set(prevSet)
      if (newSet.has(companyId)) {
        newSet.delete(companyId)
      } else {
        newSet.add(companyId)
      }
      return newSet
    })
  }, [])

  const handleOpenDrawer = useCallback((companyId: string) => {
    setSelectedCompanyId(companyId)
  }, [])

  const searchContext = {
    filterSignalIds: selectedTechs,
    filterType: "technology",
    filtersUsed: {
      technology: selectedTechs.map((id) => getTechName(id)),
      countries: selectedCountries,
    },
  }

  // Filter by selected industries (client-side)
  const filteredResults = useMemo(() => {
    if (selectedIndustries.length === 0) return results
    return results.filter(r => r.master_industry_id && selectedIndustries.includes(r.master_industry_id))
  }, [results, selectedIndustries])

  const sortedResults = useMemo(() => {
    const sorted = [...filteredResults]
    switch (sortBy) {
      case "relevance":
        sorted.sort((a, b) => b.relevance_score - a.relevance_score)
        break
      case "current":
        sorted.sort((a, b) => b.current_count - a.current_count)
        break
      case "alumni":
        sorted.sort((a, b) => b.alumni_count - a.alumni_count)
        break
      case "job_postings":
        sorted.sort((a, b) => b.job_postings_count - a.job_postings_count)
        break
    }
    return sorted
  }, [filteredResults, sortBy])

  // Extract unique industries from results for the filter
  const availableIndustries = useMemo(() => {
    const industryMap = new Map<string, { id: string; name_es: string; count: number }>()
    results.forEach(r => {
      if (r.master_industry_id && r.master_industry_name) {
        const existing = industryMap.get(r.master_industry_id)
        if (existing) {
          existing.count++
        } else {
          industryMap.set(r.master_industry_id, {
            id: r.master_industry_id,
            name_es: r.master_industry_name,
            count: 1
          })
        }
      }
    })
    return Array.from(industryMap.values()).sort((a, b) => b.count - a.count)
  }, [results])

  // Paginated results for better performance
  const paginatedResults = useMemo(() => {
    return sortedResults.slice(0, displayLimit)
  }, [sortedResults, displayLimit])

  const hasMoreResults = sortedResults.length > displayLimit

  return (
    <div className="space-y-6">
      <div className="bg-card border rounded-lg p-6 space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          {/* Technology Multi-Select */}
          <div className="space-y-2">
            <Label>Tecnologías</Label>
            <Popover open={techPopoverOpen} onOpenChange={setTechPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={techPopoverOpen}
                  className="w-full justify-between font-normal bg-transparent"
                >
                  <span className="text-muted-foreground">Agregar tecnología...</span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <div className="flex items-center border-b px-3 py-2">
                  <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                  <Input
                    placeholder="Buscar tecnología..."
                    value={techSearchQuery}
                    onChange={(e) => setTechSearchQuery(e.target.value)}
                    className="border-0 p-0 h-8 focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  {techSearchQuery && (
                    <button onClick={() => setTechSearchQuery("")} className="ml-2 text-muted-foreground hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="max-h-[250px] overflow-y-auto p-1">
                  {availableTechs.length === 0 ? (
                    <div className="py-6 text-center text-sm text-muted-foreground">
                      {techSearchQuery ? "No se encontraron tecnologías" : "Todas las tecnologías están seleccionadas"}
                    </div>
                  ) : (
                    availableTechs.map((tech) => (
                      <button
                        key={tech.id}
                        onClick={() => toggleTech(tech.id)}
                        className={cn(
                          "w-full flex items-center gap-2 px-3 py-2 text-sm rounded-sm text-left",
                          "hover:bg-accent hover:text-accent-foreground",
                          "cursor-pointer transition-colors",
                        )}
                      >
                        <Cpu className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        {tech.display_name}
                      </button>
                    ))
                  )}
                </div>
                {selectedTechs.length > 0 && (
                  <div className="border-t px-3 py-2 text-xs text-muted-foreground">
                    {selectedTechs.length} {selectedTechs.length === 1 ? "tecnología seleccionada" : "tecnologías seleccionadas"}
                  </div>
                )}
              </PopoverContent>
            </Popover>
            <div className="flex flex-wrap gap-2 min-h-[2.5rem]">
              {selectedTechs.map((id) => (
                <Badge key={id} variant="outline" className="pl-2 pr-1 py-1">
                  {getTechName(id)}
                  <button onClick={() => toggleTech(id)} className="ml-2 hover:text-destructive transition-colors">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              {selectedTechs.length === 0 && (
                <span className="text-sm text-muted-foreground italic py-1">Selecciona al menos una tecnología</span>
              )}
            </div>

            {/* Toggle OR / AND — visible solo con 2+ tecnologías */}
            {selectedTechs.length >= 2 && (
              <div
                data-onboarding="search-tech-match-mode"
                className="flex items-center gap-3 pt-1"
              >
                <span className="text-xs text-muted-foreground">Empresas con:</span>
                <div className="flex items-center rounded-md border bg-muted/40 p-0.5 gap-0.5">
                  <button
                    onClick={() => setMatchMode("cualquiera")}
                    className={cn(
                      "px-3 py-1 text-xs rounded-sm font-medium transition-all",
                      matchMode === "cualquiera"
                        ? "bg-background shadow-sm text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Al menos una
                  </button>
                  <button
                    onClick={() => setMatchMode("todas")}
                    className={cn(
                      "px-3 py-1 text-xs rounded-sm font-medium transition-all",
                      matchMode === "todas"
                        ? "bg-background shadow-sm text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Todas a la vez
                  </button>
                </div>
                <span className="text-xs text-muted-foreground">
                  {matchMode === "cualquiera"
                    ? "— amplía la cobertura"
                    : "— busca convivencia de stack"}
                </span>
              </div>
            )}
          </div>

          {/* Country Selection */}
          <div className="space-y-2">
            <Label>Países (Obligatorio)</Label>
            <CountryMultiSelect
              selectedCountries={selectedCountries}
              onCountriesChange={setSelectedCountries}
              placeholder="Agregar país..."
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2 border-t">
          <Checkbox
            id="exclude-providers"
            checked={excludeProviders}
            onCheckedChange={(checked) => setExcludeProviders(checked as boolean)}
          />
          <Label htmlFor="exclude-providers" className="text-sm font-normal cursor-pointer">
            Ocultar proveedores de servicios
          </Label>
          <ProvidersFilterTooltip />
        </div>

        <Button
          onClick={handleSearch}
          disabled={isSearching || selectedTechs.length === 0 || selectedCountries.length === 0}
          className="w-full"
          size="lg"
        >
          {isSearching ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Buscando...
            </>
          ) : (
            <>
              <Search className="mr-2 h-4 w-4" />
              Buscar por Tecnología
            </>
          )}
        </Button>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-4">
          {/* Industry Filter - Post Results */}
          {availableIndustries.length > 1 && (
            <IndustryFilterPostResults
              industries={availableIndustries}
              selectedIds={selectedIndustries}
              onSelectionChange={setSelectedIndustries}
              totalResults={results.length}
              filteredResults={sortedResults.length}
            />
          )}

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <h2 className="text-xl font-semibold">
              {sortedResults.length} {sortedResults.length === 1 ? "Empresa encontrada" : "Empresas encontradas"}
              {selectedIndustries.length > 0 && (
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  (de {results.length} totales)
                </span>
              )}
            </h2>

            <div className="flex items-center gap-4">
              <ScoringExplanation />

              <div className="flex items-center gap-2">
                <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="relevance">Score de Relevancia</SelectItem>
                    <SelectItem value="current">Empleados Actuales</SelectItem>
                    <SelectItem value="alumni">Alumni</SelectItem>
                    <SelectItem value="job_postings">Búsquedas Laborales</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="grid gap-4">
            {paginatedResults.map((company) => (
              <ResultItem
                key={company.company_id}
                company={company}
                isSelected={selectedCompanyIds.has(company.company_id)}
                onToggleSelect={toggleCompanySelection}
                onOpenDrawer={handleOpenDrawer}
              />
            ))}
          </div>

          {/* Load More Button */}
          {hasMoreResults && (
            <div className="flex justify-center pt-4">
              <Button
                variant="outline"
                onClick={() => setDisplayLimit(prev => prev + 50)}
                className="w-full max-w-xs"
              >
                Cargar más ({sortedResults.length - displayLimit} restantes)
              </Button>
            </div>
          )}
        </div>
      )}

      <BulkBookmarkButton
        selectedCompanyIds={Array.from(selectedCompanyIds)}
        searchContext={searchContext}
        onSuccess={() => setSelectedCompanyIds(new Set())}
      />

      <CompanyDrawer
        companyId={selectedCompanyId || ""}
        isOpen={!!selectedCompanyId}
        onClose={() => setSelectedCompanyId(null)}
        filterSignalIds={selectedTechs.length > 0 ? selectedTechs : undefined}
        filterType="technology"
      />
    </div>
  )
}
