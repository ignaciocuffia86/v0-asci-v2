"use client"

import { useState } from "react"
import { Search, Save, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
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
}

export default function CompaniesAdminPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [results, setResults] = useState<Company[]>([])
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const { toast } = useToast()

  const handleSearch = async () => {
    if (!searchQuery.trim()) return

    setIsSearching(true)
    const supabase = createClient()

    const { data, error } = await supabase
      .from("companies")
      .select("id, name, country, industry, website, description, linkedin_url, logo_url")
      .or(`name.ilike.%${searchQuery}%,website.ilike.%${searchQuery}%`)
      .order("name")
      .limit(20)

    if (error) {
      toast({
        title: "Error al buscar",
        description: error.message,
        variant: "destructive",
      })
    } else {
      setResults(data || [])
    }
    setIsSearching(false)
  }

  const handleSave = async () => {
    if (!selectedCompany) return

    setIsSaving(true)
    const supabase = createClient()

    const { error } = await supabase
      .from("companies")
      .update({
        name: selectedCompany.name,
        country: selectedCompany.country || null,
        industry: selectedCompany.industry || null,
        website: selectedCompany.website || null,
        description: selectedCompany.description || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", selectedCompany.id)

    if (error) {
      toast({
        title: "Error al guardar",
        description: error.message,
        variant: "destructive",
      })
    } else {
      toast({
        title: "Guardado exitoso",
        description: `Los cambios a "${selectedCompany.name}" fueron guardados.`,
      })
      // Update results list
      setResults(results.map((c) => (c.id === selectedCompany.id ? selectedCompany : c)))
    }
    setIsSaving(false)
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Gestión de Compañías</h1>
        <p className="text-muted-foreground">Busca y edita información de compañías</p>
      </div>

      {/* Search Bar */}
      <Card>
        <CardHeader>
          <CardTitle>Buscar Compañía</CardTitle>
          <CardDescription>Busca por nombre o website</CardDescription>
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

      {/* Results List */}
      {results.length > 0 && !selectedCompany && (
        <Card>
          <CardHeader>
            <CardTitle>Resultados ({results.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {results.map((company) => (
                <button
                  key={company.id}
                  onClick={() => setSelectedCompany(company)}
                  className="w-full text-left p-4 rounded-lg border hover:bg-accent hover:border-accent-foreground transition-colors"
                >
                  <div className="font-medium">{company.name}</div>
                  <div className="text-sm text-muted-foreground flex gap-4 mt-1">
                    {company.country && <span>🌍 {company.country}</span>}
                    {company.industry && <span>🏢 {company.industry}</span>}
                    {company.website && <span className="truncate max-w-xs">🔗 {company.website}</span>}
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Edit Form */}
      {selectedCompany && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Editar Compañía</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setSelectedCompany(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre</Label>
              <Input
                id="name"
                value={selectedCompany.name}
                onChange={(e) => setSelectedCompany({ ...selectedCompany, name: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="country">País</Label>
                <Input
                  id="country"
                  placeholder="Ej: Argentina, United States"
                  value={selectedCompany.country || ""}
                  onChange={(e) => setSelectedCompany({ ...selectedCompany, country: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="industry">Industria</Label>
                <Input
                  id="industry"
                  placeholder="Ej: Telecommunications"
                  value={selectedCompany.industry || ""}
                  onChange={(e) => setSelectedCompany({ ...selectedCompany, industry: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                placeholder="https://example.com"
                value={selectedCompany.website || ""}
                onChange={(e) => setSelectedCompany({ ...selectedCompany, website: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="linkedin_url">LinkedIn URL</Label>
              <Input
                id="linkedin_url"
                placeholder="https://linkedin.com/company/..."
                value={selectedCompany.linkedin_url || ""}
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
                value={selectedCompany.description || ""}
                onChange={(e) => setSelectedCompany({ ...selectedCompany, description: e.target.value })}
                rows={6}
              />
            </div>

            <div className="flex gap-2 pt-4">
              <Button onClick={handleSave} disabled={isSaving}>
                <Save className="h-4 w-4 mr-2" />
                {isSaving ? "Guardando..." : "Guardar Cambios"}
              </Button>
              <Button variant="outline" onClick={() => setSelectedCompany(null)}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
