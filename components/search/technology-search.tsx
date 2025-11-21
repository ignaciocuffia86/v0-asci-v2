"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Search, X, Building2, MapPin, Loader2, Users, GraduationCap } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { searchByTechnology, type TechnologySearchResult } from "@/app/actions/search-v2"
import { COUNTRIES } from "@/lib/constants"
import { CompanyDrawer } from "@/components/company-drawer"

export function TechnologySearch() {
  const [technologies, setTechnologies] = useState<any[]>([])
  const [selectedTech, setSelectedTech] = useState<string | null>(null)
  const [selectedCountries, setSelectedCountries] = useState<string[]>([])
  const [results, setResults] = useState<TechnologySearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    const fetchTechnologies = async () => {
      const { data } = await supabase.from("dictionary_products").select("id, name").order("name")
      setTechnologies(data || [])
    }
    fetchTechnologies()
  }, [])

  const handleSearch = async () => {
    if (!selectedTech || selectedCountries.length === 0) return

    setIsSearching(true)
    try {
      const data = await searchByTechnology(selectedTech, selectedCountries)
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

  return (
    <div className="space-y-6">
      <div className="bg-card border rounded-lg p-6 space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          {/* Technology Selection (Single) */}
          <div className="space-y-2">
            <Label>Tecnología (Única)</Label>
            <Select onValueChange={setSelectedTech} value={selectedTech || undefined}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona tecnología..." />
              </SelectTrigger>
              <SelectContent className="bg-white dark:bg-gray-950 border-border">
                {technologies.map((tech) => (
                  <SelectItem key={tech.id} value={tech.id}>
                    {tech.name}
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
          <h2 className="text-xl font-semibold">
            {results.length} {results.length === 1 ? "Empresa encontrada" : "Empresas encontradas"}
          </h2>
          <div className="grid gap-4">
            {results.map((company) => (
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
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg">{company.company_name}</h3>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                      {company.company_country && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {company.company_country}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Counters */}
                  <div className="flex gap-6">
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
