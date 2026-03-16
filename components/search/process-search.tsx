"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Search, X, Loader2, ArrowUpDown } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { searchByProcess, getIndustriesForProcessSearch, type ProcessSearchResult, type SortOption, type IndustryWithCount } from "@/app/actions/search-v2"
import { IndustryMultiSelect } from "@/components/search/industry-multi-select"
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
  const [availableIndustries, setAvailableIndustries] = useState<IndustryWithCount[]>([])
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([])
  const [isLoadingIndustries, setIsLoadingIndustries] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    const fetchProcesses = async () => {
      const { data } = await supabase.from("dictionary_processes").select("id, name").order("name")
      setProcesses(data || [])
    }
    fetchProcesses()
  }, [])

  // Fetch industries when processes and country are selected
  useEffect(() => {
    const fetchIndustries = async () => {
      if (selectedProcesses.length === 0 || selectedCountries.length === 0) {
        setAvailableIndustries([])
        setSelectedIndustries([])
        return
      }

      setIsLoadingIndustries(true)
      try {
        const industries = await getIndustriesForProcessSearch(
          selectedProcesses,
          selectedCountries,
          excludeProviders
        )
        setAvailableIndustries(industries)
        setSelectedIndustries([])
      } catch (error) {
        console.error("Error fetching industries:", error)
        setAvailableIndustries([])
      } finally {
        setIsLoadingIndustries(false)
      }
    }

    fetchIndustries()
  }, [selectedProcesses, selectedCountries, excludeProviders])

  const handleSearch = async () => {
    if (selectedProcesses.length === 0 || selectedCountries.length === 0) return

    setIsSearching(true)
    setSelectedCompanyIds(new Set())
    try {
      const data = await searchByProcess(selectedProcesses, selectedCountries, excludeProviders, selectedIndustries)
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

  const sortedResults = useMemo(() => {
    const sorted = [...results]
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
  }, [results, sortBy])

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

        {/* Industry Filter - appears after processes and country are selected */}
        {selectedProcesses.length > 0 && selectedCountries.length > 0 && (
          <div className="space-y-2">
            <Label>Filtrar por Industria (Opcional)</Label>
            <IndustryMultiSelect
              industries={availableIndustries}
              selectedIds={selectedIndustries}
              onSelectionChange={setSelectedIndustries}
              isLoading={isLoadingIndustries}
              placeholder="Todas las industrias..."
            />
            {availableIndustries.length > 0 && selectedIndustries.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {availableIndustries.length} industrias disponibles. Selecciona para filtrar resultados.
              </p>
            )}
          </div>
        )}

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
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <h2 className="text-xl font-semibold">
              {sortedResults.length} {sortedResults.length === 1 ? "Empresa encontrada" : "Empresas encontradas"}
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
            {sortedResults.map((company) => (
              <ResultItem
                key={company.company_id}
                company={company}
                isSelected={selectedCompanyIds.has(company.company_id)}
                onToggleSelect={toggleCompanySelection}
                onOpenDrawer={handleOpenDrawer}
              />
            ))}
          </div>
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
