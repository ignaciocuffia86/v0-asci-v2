"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Search, Loader2, ArrowUpDown } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { searchByTechnology, type TechnologySearchResult, type SortOption } from "@/app/actions/search-v2"
import { IndustryFilterPostResults } from "@/components/search/industry-filter-post-results"
import { CompanyDrawer } from "@/components/company-drawer"
import { ScoringExplanation, ProvidersFilterTooltip } from "@/components/search/score-tooltip"
import { CountryMultiSelect } from "@/components/search/country-multi-select"
import BulkBookmarkButton from "./bulk-bookmark-button"
import ResultItem from "./result-item" // Import the ResultItem component

type TechnologyWithVendor = {
  id: string
  name: string
  vendor_name: string | null
  display_name: string
}

export function TechnologySearch() {
  const [technologies, setTechnologies] = useState<TechnologyWithVendor[]>([])
  const [selectedTech, setSelectedTech] = useState<string | null>(null)
  const [selectedCountries, setSelectedCountries] = useState<string[]>([])
  const [results, setResults] = useState<TechnologySearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<Set<string>>(new Set())
  const [excludeProviders, setExcludeProviders] = useState(false)
  const [sortBy, setSortBy] = useState<SortOption>("relevance")
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([])
  const supabase = createClient()

  const getTechName = (id: string) => technologies.find((t) => t.id === id)?.display_name || id

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
    if (!selectedTech || selectedCountries.length === 0) return

    setIsSearching(true)
    setSelectedCompanyIds(new Set())
    setSelectedIndustries([]) // Reset industry filter on new search
    try {
      const data = await searchByTechnology(selectedTech, selectedCountries, excludeProviders)
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
    filterSignalIds: selectedTech ? [selectedTech] : [],
    filterType: "technology",
    filtersUsed: {
      technology: selectedTech ? [getTechName(selectedTech)] : [],
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

  const selectedTechData = selectedTech ? technologies.find((t) => t.id === selectedTech) : null

  return (
    <div className="space-y-6">
      <div className="bg-card border rounded-lg p-6 space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          {/* Technology Selection (Single) */}
          <div className="space-y-2">
            <Label>Tecnología (Única)</Label>
            <Select onValueChange={(value) => setSelectedTech(value)} value={selectedTech || ""}>
              <SelectTrigger>
                {selectedTechData ? (
                  <span>{selectedTechData.display_name}</span>
                ) : (
                  <SelectValue placeholder="Selecciona tecnología..." />
                )}
              </SelectTrigger>
              <SelectContent className="bg-white dark:bg-gray-950 border-border max-h-[300px]">
                {technologies.map((tech) => (
                  <SelectItem key={tech.id} value={tech.id}>
                    {tech.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          disabled={isSearching || !selectedTech || selectedCountries.length === 0}
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
        filterSignalIds={selectedTech ? [selectedTech] : undefined}
        filterType="technology"
      />
    </div>
  )
}
