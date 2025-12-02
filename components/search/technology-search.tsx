"use client"

import { useState, useEffect, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Search, X, Building2, MapPin, Loader2, Users, GraduationCap, Flame, ArrowUpDown } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { searchByTechnology, type TechnologySearchResult, type SortOption } from "@/app/actions/search-v2"
import { COUNTRIES } from "@/lib/constants"
import { CompanyDrawer } from "@/components/company-drawer"
import { ScoreTooltip, ScoringExplanation, ProvidersFilterTooltip } from "@/components/search/score-tooltip"

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
  const [excludeProviders, setExcludeProviders] = useState(false)
  const [sortBy, setSortBy] = useState<SortOption>("relevance")
  const supabase = createClient()

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
    try {
      const data = await searchByTechnology(selectedTech, selectedCountries, excludeProviders)
      setResults(data)
    } catch (error) {
      console.error(error)
    } finally {
      setIsSearching(false)
    }
  }

  const toggleCountry = (country: string) => {
    if (selectedCountries.includes(country)) {
      setSelectedCountries(selectedCountries.filter((c) => c !== country))
    } else {
      setSelectedCountries([...selectedCountries, country])
    }
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
            <Select onValueChange={toggleCountry}>
              <SelectTrigger>
                <SelectValue placeholder="Agregar país..." />
              </SelectTrigger>
              <SelectContent className="bg-white dark:bg-gray-950 border-border">
                {COUNTRIES.map((country) => (
                  <SelectItem key={country} value={country}>
                    {country}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex flex-wrap gap-2 mt-2 min-h-[2.5rem]">
              {selectedCountries.map((country) => (
                <Badge key={country} variant="outline" className="pl-2 pr-1 py-1">
                  {country}
                  <button onClick={() => toggleCountry(country)} className="ml-2 hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              {selectedCountries.length === 0 && (
                <span className="text-sm text-muted-foreground italic py-1">Selecciona al menos un país</span>
              )}
            </div>
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

          <div className="grid gap-4">
            {sortedResults.map((company) => (
              <div
                key={company.company_id}
                className="bg-card border rounded-lg p-6 hover:border-primary/50 transition-colors cursor-pointer"
                onClick={() => setSelectedCompanyId(company.company_id)}
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-muted rounded-md flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {company.company_logo_url ? (
                      <img
                        src={company.company_logo_url || "/placeholder.svg"}
                        alt={company.company_name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Building2 className="h-6 w-6 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-lg">{company.company_name}</h3>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                      {company.company_country && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {company.company_country}
                        </span>
                      )}
                      {company.company_industry && <span className="truncate">{company.company_industry}</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    <div className="text-center border-r pr-6">
                      <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">
                        Score
                      </div>
                      <ScoreTooltip
                        totalScore={company.relevance_score}
                        currentScore={company.current_score}
                        alumniScore={company.alumni_score}
                        jobPostingsScore={company.job_postings_score}
                        currentCount={company.current_count}
                        alumniCount={company.alumni_count}
                        jobPostingsCount={company.job_postings_count}
                      />
                    </div>

                    {/* Counters */}
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1 text-primary font-bold text-2xl">
                        <Users className="h-5 w-5" />
                        {company.current_count}
                      </div>
                      <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Actuales</div>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1 text-muted-foreground font-bold text-2xl">
                        <GraduationCap className="h-5 w-5" />
                        {company.alumni_count}
                      </div>
                      <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Alumni</div>
                    </div>
                    {company.job_postings_count > 0 && (
                      <div className="text-center">
                        <div className="flex items-center justify-center gap-1 text-orange-600 font-bold text-2xl">
                          <Flame className="h-5 w-5" />
                          {company.job_postings_count}
                        </div>
                        <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                          Búsquedas
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
