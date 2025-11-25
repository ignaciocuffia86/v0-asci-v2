"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Search, X, Building2, MapPin, Loader2, Flame } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { searchByProcess, type ProcessSearchResult } from "@/app/actions/search-v2"
import { COUNTRIES } from "@/lib/constants"
import { CompanyDrawer } from "@/components/company-drawer"

export function ProcessSearch() {
  const [processes, setProcesses] = useState<any[]>([])
  const [selectedProcesses, setSelectedProcesses] = useState<string[]>([])
  const [selectedCountries, setSelectedCountries] = useState<string[]>([])
  const [results, setResults] = useState<ProcessSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
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
    try {
      const data = await searchByProcess(selectedProcesses, selectedCountries)
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

  const toggleCountry = (country: string) => {
    if (selectedCountries.includes(country)) {
      setSelectedCountries(selectedCountries.filter((c) => c !== country))
    } else {
      setSelectedCountries([...selectedCountries, country])
    }
  }

  const getProcessName = (id: string) => processes.find((p) => p.id === id)?.name || id

  return (
    <div className="space-y-6">
      <div className="bg-card border rounded-lg p-6 space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
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
                  <div className="flex gap-6">
                    <div className="text-center px-4">
                      <div className="text-3xl font-bold text-primary">{company.signal_count}</div>
                      <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                        Empleados Actuales
                      </div>
                    </div>
                    {company.job_postings_count > 0 && (
                      <div className="text-center px-4">
                        <div className="flex items-center justify-center gap-1 text-2xl font-bold text-orange-600">
                          <Flame className="h-5 w-5" />
                          {company.job_postings_count}
                        </div>
                        <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                          Posiciones Abiertas
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
        filterSignalIds={selectedProcesses}
        filterType="process"
      />
    </div>
  )
}
