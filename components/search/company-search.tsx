"use client"

import { Badge } from "@/components/ui/badge"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Search, Building2, Loader2, Users, GraduationCap, Flame } from "lucide-react"
import { searchCompaniesByName, getCompanySignalSummary, type CompanySignalSummary } from "@/app/actions/search-v2"
import { CompanyDrawer } from "@/components/company-drawer"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function CompanySearch() {
  const [query, setQuery] = useState("")
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [selectedCompany, setSelectedCompany] = useState<any | null>(null)
  const [summary, setSummary] = useState<CompanySignalSummary | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (query.length >= 2 && !selectedCompany) {
        const results = await searchCompaniesByName(query)
        setSuggestions(results)
      } else {
        setSuggestions([])
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [query, selectedCompany])

  const handleSelectCompany = async (company: any) => {
    setSelectedCompany(company)
    setQuery(company.name)
    setSuggestions([])
    setIsLoading(true)

    try {
      const data = await getCompanySignalSummary(company.id)
      setSummary(data)
    } catch (error) {
      console.error(error)
    } finally {
      setIsLoading(false)
    }
  }

  const clearSearch = () => {
    setQuery("")
    setSelectedCompany(null)
    setSummary(null)
    setSuggestions([])

  }

  return (
    <div className="space-y-6">
      <div className="bg-card border rounded-lg p-6 space-y-6">
        <div className="relative">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar empresa por nombre..."
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSelectedCompany(null)
                }}
                className="pl-9"
              />
            </div>
            {selectedCompany && (
              <Button variant="outline" onClick={clearSearch}>
                Limpiar
              </Button>
            )}
          </div>

          {suggestions.length > 0 && !selectedCompany && (
            <div className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-md overflow-hidden max-h-[300px] overflow-y-auto">
              {suggestions.map((company) => (
                <div
                  key={company.id}
                  className="p-3 hover:bg-accent cursor-pointer flex items-center gap-3"
                  onClick={() => handleSelectCompany(company)}
                >
                  <div className="w-8 h-8 bg-muted rounded flex items-center justify-center flex-shrink-0">
                    {company.logo_url ? (
                      <img
                        src={company.logo_url || "/placeholder.svg"}
                        alt=""
                        className="w-full h-full object-cover rounded"
                      />
                    ) : (
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div>
                    <div className="font-medium">{company.name}</div>
                    <div className="text-xs text-muted-foreground">{company.country}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : summary && selectedCompany ? (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-muted rounded-lg flex items-center justify-center overflow-hidden border">
                  {selectedCompany.logo_url ? (
                    <img
                      src={selectedCompany.logo_url || "/placeholder.svg"}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Building2 className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>
                <div>
                  <h2 className="text-2xl font-bold">{selectedCompany.name}</h2>
                  <p className="text-muted-foreground">
                    {selectedCompany.industry} • {selectedCompany.country}
                  </p>
                </div>
              </div>
              <Button onClick={() => setIsDrawerOpen(true)}>Ver Detalles Completos</Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Señales</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{summary.total_signals}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Users className="h-4 w-4" /> Empleados Actuales
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-primary">{summary.current_employees_with_signals}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <GraduationCap className="h-4 w-4" /> Alumni (Tech)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-muted-foreground">{summary.alumni_with_tech_signals}</div>
                </CardContent>
              </Card>
              <Card className={(selectedCompany?.job_postings_count || 0) > 0 ? "border-orange-200 bg-orange-50/50" : ""}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Flame className={`h-4 w-4 ${(selectedCompany?.job_postings_count || 0) > 0 ? "text-orange-500" : ""}`} /> Búsquedas Laborales
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div
                    className={`text-3xl font-bold ${(selectedCompany?.job_postings_count || 0) > 0 ? "text-orange-600" : "text-muted-foreground"}`}
                  >
                    {selectedCompany?.job_postings_count || 0}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <h3 className="font-semibold">Top Procesos Detectados</h3>
                {summary.top_processes?.length > 0 ? (
                  <div className="space-y-2">
                    {summary.top_processes.map((proc: any, i: number) => (
                      <div key={i} className="flex justify-between items-center p-3 bg-muted/50 rounded-md">
                        <span className="font-medium">{proc.process_name}</span>
                        <Badge variant="secondary">{proc.count} señales</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No se detectaron procesos.</p>
                )}
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold">Top Tecnologías Detectadas</h3>
                {summary.top_technologies?.length > 0 ? (
                  <div className="space-y-2">
                    {summary.top_technologies.map((tech: any, i: number) => (
                      <div key={i} className="flex justify-between items-center p-3 bg-muted/50 rounded-md">
                        <span className="font-medium">{tech.product_name}</span>
                        <Badge variant="secondary">{tech.count} señales</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No se detectaron tecnologías.</p>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <CompanyDrawer
        companyId={selectedCompany?.id || ""}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
      />
    </div>
  )
}
