"use client"

import { useState, useEffect } from "react"
import { Search, Save, X, AlertCircle, ArrowRightLeft } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  searchCompanies,
  updateCompany,
  findDuplicates,
  getCountriesList,
  getIndustriesList,
  mergeCompanies,
} from "@/app/actions/companies"
import { useToast } from "@/hooks/use-toast"

type Company = {
  id: string
  name: string
  country: string | null
  industry: string | null
  website: string | null
  description: string | null
  linkedin_url: string | null
  logo_url: string | null
  normalized_name: string | null
}

export default function CompaniesAdminPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [results, setResults] = useState<Company[]>([])
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null)
  const [editedCompany, setEditedCompany] = useState<Company | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [duplicates, setDuplicates] = useState<Company[]>([])
  const [isLoadingDuplicates, setIsLoadingDuplicates] = useState(false)
  const [countries, setCountries] = useState<string[]>([])
  const [industries, setIndustries] = useState<string[]>([])
  const [countryInput, setCountryInput] = useState("")
  const [industryInput, setIndustryInput] = useState("")
  const [showCountrySuggestions, setShowCountrySuggestions] = useState(false)
  const [showIndustrySuggestions, setShowIndustrySuggestions] = useState(false)
  const [mergeModalOpen, setMergeModalOpen] = useState(false)
  const [mergeSource, setMergeSource] = useState<Company | null>(null)
  const [mergeTargetId, setMergeTargetId] = useState<string>("")
  const [isMerging, setIsMerging] = useState(false)
  const { toast } = useToast()

  // Load countries and industries on mount
  useEffect(() => {
    async function loadOptions() {
      try {
        const [countriesList, industriesList] = await Promise.all([getCountriesList(), getIndustriesList()])
        setCountries(countriesList)
        setIndustries(industriesList)
      } catch (error) {
        console.error("Error loading options:", error)
      }
    }
    loadOptions()
  }, [])

  // Load duplicates when company is selected
  useEffect(() => {
    if (selectedCompany) {
      loadDuplicates(selectedCompany.id)
    } else {
      setDuplicates([])
    }
  }, [selectedCompany])

  const handleSearch = async () => {
    if (!searchQuery.trim()) return

    setIsSearching(true)
    try {
      const data = await searchCompanies(searchQuery)
      setResults(data || [])
      // Clear selection when searching again
      setSelectedCompany(null)
      setEditedCompany(null)
    } catch (error: any) {
      toast({
        title: "Error al buscar",
        description: error.message,
        variant: "destructive",
      })
    }
    setIsSearching(false)
  }

  const loadDuplicates = async (companyId: string) => {
    setIsLoadingDuplicates(true)
    try {
      const data = await findDuplicates(companyId)
      setDuplicates(data || [])
    } catch (error: any) {
      console.error("Error loading duplicates:", error)
    }
    setIsLoadingDuplicates(false)
  }

  const handleSelectCompany = (company: Company) => {
    setSelectedCompany(company)
    setEditedCompany({ ...company })
    setCountryInput(company.country || "")
    setIndustryInput(company.industry || "")
  }

  const handleSave = async () => {
    if (!editedCompany) return

    setIsSaving(true)
    try {
      await updateCompany(editedCompany.id, {
        name: editedCompany.name,
        country: countryInput.trim() || null,
        industry: industryInput.trim() || null,
        website: editedCompany.website,
        description: editedCompany.description,
      })

      toast({
        title: "Guardado exitoso",
        description: `Los cambios a "${editedCompany.name}" fueron guardados.`,
      })

      // Update in results list
      setResults(results.map((c) => (c.id === editedCompany.id ? { ...editedCompany, country: countryInput.trim() || null, industry: industryInput.trim() || null } : c)))
      setSelectedCompany({ ...editedCompany, country: countryInput.trim() || null, industry: industryInput.trim() || null })
    } catch (error: any) {
      toast({
        title: "Error al guardar",
        description: error.message,
        variant: "destructive",
      })
    }
    setIsSaving(false)
  }

  const handleOpenMergeModal = (duplicate: Company) => {
    setMergeSource(duplicate)
    setMergeTargetId(selectedCompany!.id) // Default: keep current company as target
    setMergeModalOpen(true)
  }

  const handleMerge = async () => {
    if (!mergeSource || !mergeTargetId) return

    const sourceId = mergeTargetId === selectedCompany?.id ? mergeSource.id : selectedCompany!.id
    const targetId = mergeTargetId

    setIsMerging(true)
    try {
      await mergeCompanies(sourceId, targetId)

      toast({
        title: "Fusión exitosa",
        description: `Las compañías fueron fusionadas correctamente.`,
      })

      // Reload duplicates and clear merge state
      if (selectedCompany) {
        await loadDuplicates(selectedCompany.id)
      }
      setMergeModalOpen(false)
      setMergeSource(null)
    } catch (error: any) {
      toast({
        title: "Error al fusionar",
        description: error.message,
        variant: "destructive",
      })
    }
    setIsMerging(false)
  }

  const filteredCountries = countries.filter((c) => c.toLowerCase().includes(countryInput.toLowerCase()))
  const filteredIndustries = industries.filter((i) => i.toLowerCase().includes(industryInput.toLowerCase()))

  return (
    <div className="container mx-auto py-8 space-y-6 max-w-7xl">
      <div>
        <h1 className="text-3xl font-bold mb-2">Gestión de Compañías</h1>
        <p className="text-muted-foreground">Busca, edita y fusiona información de compañías</p>
      </div>

      {/* Search Bar */}
      <Card>
        <CardHeader>
          <CardTitle>Buscar Compañía</CardTitle>
          <CardDescription>Busca por nombre, website o LinkedIn URL</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="Ej: Personal, mercadolibre.com.ar"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <Button onClick={handleSearch} disabled={isSearching}>
              <Search className="h-4 w-4 mr-2" />
              {isSearching ? "Buscando..." : "Buscar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Results List */}
        <div>
          {results.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Resultados ({results.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {results.map((company) => (
                    <button
                      key={company.id}
                      onClick={() => handleSelectCompany(company)}
                      className={`w-full text-left p-4 rounded-lg border transition-colors ${
                        selectedCompany?.id === company.id
                          ? "bg-accent border-accent-foreground"
                          : "hover:bg-accent hover:border-accent-foreground"
                      }`}
                    >
                      <div className="font-medium">{company.name}</div>
                      <div className="text-sm text-muted-foreground flex flex-wrap gap-2 mt-1">
                        {company.country && <Badge variant="outline">{company.country}</Badge>}
                        {company.industry && <Badge variant="outline">{company.industry}</Badge>}
                      </div>
                      {company.website && (
                        <div className="text-xs text-muted-foreground mt-1 truncate">{company.website}</div>
                      )}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Edit Panel */}
        {editedCompany && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Editar Compañía</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => { setSelectedCompany(null); setEditedCompany(null) }}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nombre</Label>
                  <Input
                    id="name"
                    value={editedCompany.name}
                    onChange={(e) => setEditedCompany({ ...editedCompany, name: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Country Autocomplete */}
                  <div className="space-y-2 relative">
                    <Label htmlFor="country">País</Label>
                    <Input
                      id="country"
                      placeholder="Ej: Argentina"
                      value={countryInput}
                      onChange={(e) => {
                        setCountryInput(e.target.value)
                        setShowCountrySuggestions(true)
                      }}
                      onFocus={() => setShowCountrySuggestions(true)}
                      onBlur={() => setTimeout(() => setShowCountrySuggestions(false), 200)}
                    />
                    {showCountrySuggestions && filteredCountries.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-md max-h-60 overflow-auto">
                        {filteredCountries.slice(0, 10).map((country) => (
                          <button
                            key={country}
                            className="w-full text-left px-3 py-2 hover:bg-accent text-sm"
                            onClick={() => {
                              setCountryInput(country)
                              setShowCountrySuggestions(false)
                            }}
                          >
                            {country}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Industry Autocomplete */}
                  <div className="space-y-2 relative">
                    <Label htmlFor="industry">Industria</Label>
                    <Input
                      id="industry"
                      placeholder="Ej: Telecommunications"
                      value={industryInput}
                      onChange={(e) => {
                        setIndustryInput(e.target.value)
                        setShowIndustrySuggestions(true)
                      }}
                      onFocus={() => setShowIndustrySuggestions(true)}
                      onBlur={() => setTimeout(() => setShowIndustrySuggestions(false), 200)}
                    />
                    {showIndustrySuggestions && filteredIndustries.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-md max-h-60 overflow-auto">
                        {filteredIndustries.slice(0, 10).map((industry) => (
                          <button
                            key={industry}
                            className="w-full text-left px-3 py-2 hover:bg-accent text-sm"
                            onClick={() => {
                              setIndustryInput(industry)
                              setShowIndustrySuggestions(false)
                            }}
                          >
                            {industry}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="website">Website</Label>
                  <Input
                    id="website"
                    placeholder="https://example.com"
                    value={editedCompany.website || ""}
                    onChange={(e) => setEditedCompany({ ...editedCompany, website: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="linkedin_url">LinkedIn URL</Label>
                  <Input
                    id="linkedin_url"
                    value={editedCompany.linkedin_url || ""}
                    disabled
                    className="opacity-50"
                  />
                  <p className="text-xs text-muted-foreground">LinkedIn URL es de solo lectura</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Descripción</Label>
                  <Textarea
                    id="description"
                    placeholder="Descripción de la compañía"
                    value={editedCompany.description || ""}
                    onChange={(e) => setEditedCompany({ ...editedCompany, description: e.target.value })}
                    rows={4}
                  />
                </div>

                <div className="flex gap-2 pt-4">
                  <Button onClick={handleSave} disabled={isSaving}>
                    <Save className="h-4 w-4 mr-2" />
                    {isSaving ? "Guardando..." : "Guardar Cambios"}
                  </Button>
                  <Button variant="outline" onClick={() => { setSelectedCompany(null); setEditedCompany(null) }}>
                    Cancelar
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Duplicates Section */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-orange-500" />
                  Posibles Duplicados
                </CardTitle>
                <CardDescription>
                  Búsqueda por nombre normalizado, LinkedIn URL y website
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingDuplicates ? (
                  <div className="text-sm text-muted-foreground">Buscando duplicados...</div>
                ) : duplicates.length > 0 ? (
                  <div className="space-y-2">
                    {duplicates.map((dup) => (
                      <div
                        key={dup.id}
                        className="p-3 border rounded-lg flex items-center justify-between hover:bg-accent"
                      >
                        <div className="flex-1">
                          <div className="font-medium text-sm">{dup.name}</div>
                          <div className="text-xs text-muted-foreground flex flex-wrap gap-2 mt-1">
                            {dup.country && <span>{dup.country}</span>}
                            {dup.industry && <span>• {dup.industry}</span>}
                          </div>
                          {dup.website && (
                            <div className="text-xs text-muted-foreground mt-1 truncate">{dup.website}</div>
                          )}
                        </div>
                        <Button variant="outline" size="sm" className="ml-2" onClick={() => handleOpenMergeModal(dup)}>
                          <ArrowRightLeft className="h-3 w-3 mr-1" />
                          Fusionar
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Alert>
                    <AlertDescription>No se encontraron duplicados potenciales.</AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Merge Modal */}
      <Dialog open={mergeModalOpen} onOpenChange={setMergeModalOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Fusionar Compañías</DialogTitle>
            <DialogDescription>
              Selecciona cuál compañía será la principal (destino). Los contactos, señales y datos se consolidarán en la compañía principal.
            </DialogDescription>
          </DialogHeader>

          {mergeSource && selectedCompany && (
            <div className="space-y-4">
              <RadioGroup value={mergeTargetId} onValueChange={setMergeTargetId}>
                <div className="grid grid-cols-2 gap-4">
                  {/* Current Company */}
                  <div className={`border rounded-lg p-4 ${mergeTargetId === selectedCompany.id ? 'border-primary bg-accent' : ''}`}>
                    <div className="flex items-center space-x-2 mb-3">
                      <RadioGroupItem value={selectedCompany.id} id="target-current" />
                      <Label htmlFor="target-current" className="font-semibold cursor-pointer">
                        Compañía Actual (Principal)
                      </Label>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="font-medium text-base">{selectedCompany.name}</div>
                      {selectedCompany.country && <div className="text-muted-foreground">País: {selectedCompany.country}</div>}
                      {selectedCompany.industry && <div className="text-muted-foreground">Industria: {selectedCompany.industry}</div>}
                      {selectedCompany.website && <div className="text-muted-foreground truncate">Website: {selectedCompany.website}</div>}
                      {selectedCompany.linkedin_url && <div className="text-muted-foreground truncate">LinkedIn: {selectedCompany.linkedin_url}</div>}
                    </div>
                  </div>

                  {/* Duplicate Company */}
                  <div className={`border rounded-lg p-4 ${mergeTargetId === mergeSource.id ? 'border-primary bg-accent' : ''}`}>
                    <div className="flex items-center space-x-2 mb-3">
                      <RadioGroupItem value={mergeSource.id} id="target-duplicate" />
                      <Label htmlFor="target-duplicate" className="font-semibold cursor-pointer">
                        Duplicado (Principal)
                      </Label>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="font-medium text-base">{mergeSource.name}</div>
                      {mergeSource.country && <div className="text-muted-foreground">País: {mergeSource.country}</div>}
                      {mergeSource.industry && <div className="text-muted-foreground">Industria: {mergeSource.industry}</div>}
                      {mergeSource.website && <div className="text-muted-foreground truncate">Website: {mergeSource.website}</div>}
                      {mergeSource.linkedin_url && <div className="text-muted-foreground truncate">LinkedIn: {mergeSource.linkedin_url}</div>}
                    </div>
                  </div>
                </div>
              </RadioGroup>

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>¿Qué se consolidará?</strong>
                  <ul className="list-disc list-inside mt-2 text-sm space-y-1">
                    <li>Todos los contactos se moverán a la compañía principal</li>
                    <li>Todas las señales (procesos/tecnologías) se moverán a la compañía principal</li>
                    <li>Todos los bookmarks se actualizarán a la compañía principal</li>
                    <li>Todos los job postings se moverán a la compañía principal</li>
                    <li>La compañía secundaria será eliminada</li>
                  </ul>
                </AlertDescription>
              </Alert>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeModalOpen(false)} disabled={isMerging}>
              Cancelar
            </Button>
            <Button onClick={handleMerge} disabled={isMerging || !mergeTargetId}>
              {isMerging ? "Fusionando..." : "Confirmar Fusión"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
