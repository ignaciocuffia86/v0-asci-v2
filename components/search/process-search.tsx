"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Search, X, Loader2, ArrowUpDown } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { searchByProcess, type ProcessSearchResult, type SortOption } from "@/app/actions/search-v2"
import { IndustryFilterPostResults } from "@/components/search/industry-filter-post-results"
import { CompanyDrawer } from "@/components/company-drawer"
import { ScoringExplanation, ProvidersFilterTooltip } from "@/components/search/score-tooltip"
import { CountryMultiSelect } from "@/components/search/country-multi-select"
import BulkBookmarkButton from "./bulk-bookmark-button"
import ResultItem from "./result-item" // use correct import path

export function ProcessSearch() {
  const [processes, setProcesses] = useState<any[]>([])
  const [selectedProcesses, setSelectedProcesses] = useState<string[]>([])
  const [selectedCountries, setSelectedCountries] = useState<string[]>([])
  const [results, setResults] = useState<ProcessSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<Set<string>>(new Set())
  const [excludeProviders, setExcludeProviders] = useState(false)
  const [sortBy, setSortBy] = useState<SortOption>("relevance")
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([])
  const [displayLimit, setDisplayLimit] = useState(50)
  const supabase = createClient()

  useEffect(() => {
    const fetchProcesses = async () => {
      const { data } = await supabase.from("dictionary_processes").select("id, name").order("name")
      setProcesses(data || [])
    }
    fetchProcesses()
  }, [])

  const handleSearch = async () => {
    if (selectedProcesses.length === 0 || selectedCountries.length === 0) return

    setIsSearching(true)
    setSelectedCompanyIds(new Set())
    setSelectedIndustries([]) // Reset industry filter on new search
    setDisplayLimit(50) // Reset pagination on new search
    try {
      const data = await searchByProcess(selectedProcesses, selectedCountries, excludeProviders)
      setResults(data)
    } catch (error) {
      console.error(error)
    } finally {
      setIsSearching(false)
    }
  }

  const toggleProcess = (id: string) => {
    if (selectedProcesses.includes(id)) {
      setSelectedProcesses(selectedProcesses.filter((p) => p !== id))
    } else {
      setSelectedProcesses([...selectedProcesses, id])
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

  const getProcessName = (id: string) => processes.find((p) => p.id === id)?.name || id

  const handleOpenDrawer = useCallback((companyId: string) => {
    setSelectedCompanyId(companyId)
  }, [])

  const searchContext = {
    filterSignalIds: selectedProcesses,
    filterType: "process",
    filtersUsed: {
      process: selectedProcesses.map((id) => getProcessName(id)),
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
        <div className="grid gap-6 md:grid-cols-2" data-onboarding="search-filters">
          {/* Process Selection */}
          <div className="space-y-2">
            <Label>Procesos (Tags)</Label>
            <Select onValueChange={toggleProcess}>
              <SelectTrigger>
                <SelectValue placeholder="Agregar proceso..." />
              </SelectTrigger>
              <SelectContent className="bg-white dark:bg-gray-950 border-border">
                {processes.map((proc) => (
                  <SelectItem key={proc.id} value={proc.id}>
                    {proc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex flex-wrap gap-2 mt-2 min-h-[2.5rem]">
              {selectedProcesses.map((id) => (
                <Badge key={id} variant="secondary" className="pl-2 pr-1 py-1">
                  {getProcessName(id)}
                  <button onClick={() => toggleProcess(id)} className="ml-2 hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              {selectedProcesses.length === 0 && (
                <span className="text-sm text-muted-foreground italic py-1">Selecciona al menos un proceso</span>
              )}
            </div>
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
            id="exclude-providers-process"
            checked={excludeProviders}
            onCheckedChange={(checked) => setExcludeProviders(checked as boolean)}
          />
          <Label htmlFor="exclude-providers-process" className="text-sm font-normal cursor-pointer">
            Ocultar proveedores de servicios
          </Label>
          <ProvidersFilterTooltip />
        </div>

        <Button
          onClick={handleSearch}
          disabled={isSearching || selectedProcesses.length === 0 || selectedCountries.length === 0}
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
              Buscar por Proceso
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

          <div className="grid gap-4" data-onboarding="search-results">
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
        filterSignalIds={selectedProcesses}
        filterType="process"
      />
    </div>
  )
}
