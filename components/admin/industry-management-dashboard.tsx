"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { toast } from "sonner"
import {
  Building2,
  FileText,
  Layers,
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Monitor,
  Landmark,
  Shield,
  Heart,
  GraduationCap,
  ShoppingCart,
  Factory,
  Zap,
  Radio,
  Building,
  Truck,
  Briefcase,
  Tv,
  Hotel,
  UtensilsCrossed,
  Wheat,
  Mountain,
  Car,
  Plane,
  HeartHandshake,
  Scale,
  Users,
  MoreHorizontal,
  Sparkles,
  type LucideIcon,
} from "lucide-react"

// Map icon names to components
const iconMap: Record<string, LucideIcon> = {
  Monitor,
  Landmark,
  Building2,
  Shield,
  Heart,
  GraduationCap,
  ShoppingCart,
  Factory,
  Zap,
  Radio,
  Building,
  Truck,
  Briefcase,
  Tv,
  Hotel,
  UtensilsCrossed,
  Wheat,
  Mountain,
  Car,
  Plane,
  HeartHandshake,
  Scale,
  Users,
  MoreHorizontal,
}

function IndustryIcon({ name, className }: { name: string; className?: string }) {
  const IconComponent = iconMap[name] || Layers
  return <IconComponent className={className} />
}

interface Stats {
  masterIndustries: number
  companyMappings: {
    total: number
    mapped: number
    unmapped: number
    mappingRules: number
  }
  documentMappings: {
    total: number
    mapped: number
    unmapped: number
    mappingRules: number
  }
}

interface UnmappedItem {
  originalValue: string
  sourceType: string
  count: number
}

interface MasterIndustry {
  id: string
  name_en: string
  name_es: string
  icon: string
  display_order: number
  companyCount: number
  documentCount: number
}

export function IndustryManagementDashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [unmapped, setUnmapped] = useState<UnmappedItem[]>([])
  const [masterIndustries, setMasterIndustries] = useState<MasterIndustry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [bulkMasterIndustry, setBulkMasterIndustry] = useState<string>("")
  const [itemMappings, setItemMappings] = useState<Record<string, string>>({})
  const [activeTab, setActiveTab] = useState("companies")

  const fetchData = async () => {
    setLoading(true)
    try {
      const [statsRes, unmappedRes, masterRes] = await Promise.all([
        fetch("/api/admin/industries/stats"),
        fetch("/api/admin/industries/unmapped"),
        fetch("/api/admin/industries/master"),
      ])

      if (statsRes.ok) {
        const data = await statsRes.json()
        setStats(data)
      }

      if (unmappedRes.ok) {
        const data = await unmappedRes.json()
        setUnmapped(data.unmapped || [])
      }

      if (masterRes.ok) {
        const data = await masterRes.json()
        setMasterIndustries(data.industries || [])
      }
    } catch (error) {
      console.error("Error fetching data:", error)
      toast.error("Error al cargar datos")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const filteredUnmapped = unmapped.filter(item => 
    activeTab === "companies" ? item.sourceType === "company" : item.sourceType === "document"
  )

  const handleSelectItem = (key: string, checked: boolean) => {
    const newSelected = new Set(selectedItems)
    if (checked) {
      newSelected.add(key)
    } else {
      newSelected.delete(key)
    }
    setSelectedItems(newSelected)
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedItems(new Set(filteredUnmapped.map(item => `${item.sourceType}:${item.originalValue}`)))
    } else {
      setSelectedItems(new Set())
    }
  }

  const handleIndividualMapping = (item: UnmappedItem, masterIndustryId: string) => {
    setItemMappings(prev => ({
      ...prev,
      [`${item.sourceType}:${item.originalValue}`]: masterIndustryId,
    }))
  }

  const handleSaveMappings = async () => {
    const mappingsToSave: { originalValue: string; sourceType: string; masterIndustryId: string }[] = []

    // Add individual mappings
    Object.entries(itemMappings).forEach(([key, masterIndustryId]) => {
      if (masterIndustryId) {
        const [sourceType, ...rest] = key.split(":")
        const originalValue = rest.join(":")
        mappingsToSave.push({ originalValue, sourceType, masterIndustryId })
      }
    })

    // Add bulk mappings for selected items without individual mapping
    if (bulkMasterIndustry) {
      selectedItems.forEach(key => {
        if (!itemMappings[key]) {
          const [sourceType, ...rest] = key.split(":")
          const originalValue = rest.join(":")
          mappingsToSave.push({ originalValue, sourceType, masterIndustryId: bulkMasterIndustry })
        }
      })
    }

    if (mappingsToSave.length === 0) {
      toast.error("No hay mapeos para guardar")
      return
    }

    setSaving(true)
    try {
      const res = await fetch("/api/admin/industries/map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mappings: mappingsToSave }),
      })

      if (res.ok) {
        toast.success(`${mappingsToSave.length} mapeos guardados`)
        setSelectedItems(new Set())
        setItemMappings({})
        setBulkMasterIndustry("")
        fetchData()
      } else {
        const data = await res.json()
        toast.error(data.error || "Error al guardar mapeos")
      }
    } catch {
      toast.error("Error de conexion")
    } finally {
      setSaving(false)
    }
  }

  const handleSuggestWithAI = async () => {
    setSuggesting(true)
    try {
      const res = await fetch("/api/admin/industries/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 100, source: "all" }),
      })
      const data = await res.json()
      if (res.ok) {
        if (data.applied > 0) {
          toast.success(`IA mapeo ${data.applied} industrias automaticamente${data.skipped ? ` (${data.skipped} sin match claro)` : ""}`)
        } else {
          toast.info(data.message || "La IA no encontro mapeos nuevos para aplicar")
        }
        fetchData()
      } else {
        toast.error(data.error || "Error al sugerir mapeos con IA")
      }
    } catch {
      toast.error("Error de conexion")
    } finally {
      setSuggesting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const companyPct = stats ? Math.round((stats.companyMappings.mapped / stats.companyMappings.total) * 100) : 0
  const docPct = stats ? Math.round((stats.documentMappings.mapped / Math.max(stats.documentMappings.total, 1)) * 100) : 0

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Industrias Maestras</CardTitle>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.masterIndustries || 0}</div>
            <p className="text-xs text-muted-foreground">Categorias disponibles</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Companies</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{companyPct}%</div>
            <p className="text-xs text-muted-foreground">
              {stats?.companyMappings.mapped.toLocaleString()} de {stats?.companyMappings.total.toLocaleString()} normalizadas
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Documentos</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{docPct}%</div>
            <p className="text-xs text-muted-foreground">
              {stats?.documentMappings.mapped} de {stats?.documentMappings.total} normalizados
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sin Mapear</CardTitle>
            <AlertCircle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">
              {(stats?.companyMappings.unmapped || 0) + (stats?.documentMappings.unmapped || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats?.companyMappings.unmapped} companies, {stats?.documentMappings.unmapped} docs
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="companies" className="gap-2">
              <Building2 className="h-4 w-4" />
              Companies ({unmapped.filter(i => i.sourceType === "company").length})
            </TabsTrigger>
            <TabsTrigger value="documents" className="gap-2">
              <FileText className="h-4 w-4" />
              Documentos ({unmapped.filter(i => i.sourceType === "document").length})
            </TabsTrigger>
            <TabsTrigger value="master" className="gap-2">
              <Layers className="h-4 w-4" />
              Industrias Maestras
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={handleSuggestWithAI}
              disabled={suggesting}
              className="gap-2"
            >
              {suggesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {suggesting ? "Sugiriendo..." : "Sugerir con IA"}
            </Button>
            <Button variant="outline" size="sm" onClick={fetchData} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Actualizar
            </Button>
          </div>
        </div>

        {/* Companies Tab */}
        <TabsContent value="companies" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Industrias de Companies sin Mapear</CardTitle>
              <CardDescription>
                Asigna cada industria a una categoria maestra para normalizar los datos
              </CardDescription>
            </CardHeader>
            <CardContent>
              {filteredUnmapped.length > 0 ? (
                <>
                  {/* Bulk Actions */}
                  {selectedItems.size > 0 && (
                    <div className="flex items-center gap-4 mb-4 p-3 bg-muted/50 rounded-lg">
                      <span className="text-sm font-medium">{selectedItems.size} seleccionados</span>
                      <Select value={bulkMasterIndustry} onValueChange={setBulkMasterIndustry}>
                        <SelectTrigger className="w-[200px]">
                          <SelectValue placeholder="Asignar a..." />
                        </SelectTrigger>
                        <SelectContent>
                          {masterIndustries.map(mi => (
                            <SelectItem key={mi.id} value={mi.id}>
                              <span className="flex items-center gap-2">
                                <IndustryIcon name={mi.icon} className="h-4 w-4" />
                                {mi.name_es}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button onClick={handleSaveMappings} disabled={saving} className="gap-2">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        Guardar
                      </Button>
                    </div>
                  )}

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">
                          <Checkbox
                            checked={selectedItems.size === filteredUnmapped.length && filteredUnmapped.length > 0}
                            onCheckedChange={handleSelectAll}
                          />
                        </TableHead>
                        <TableHead>Industria Original</TableHead>
                        <TableHead className="text-center">Companies</TableHead>
                        <TableHead className="w-[250px]">Asignar a</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUnmapped.map(item => {
                        const key = `${item.sourceType}:${item.originalValue}`
                        return (
                          <TableRow key={key}>
                            <TableCell>
                              <Checkbox
                                checked={selectedItems.has(key)}
                                onCheckedChange={(checked) => handleSelectItem(key, !!checked)}
                              />
                            </TableCell>
                            <TableCell className="font-medium">{item.originalValue}</TableCell>
                            <TableCell className="text-center">
                              <Badge variant="secondary">{item.count}</Badge>
                            </TableCell>
                            <TableCell>
                              <Select
                                value={itemMappings[key] || ""}
                                onValueChange={(val) => handleIndividualMapping(item, val)}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Seleccionar..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {masterIndustries.map(mi => (
                                    <SelectItem key={mi.id} value={mi.id}>
                                      <span className="flex items-center gap-2">
                                        <IndustryIcon name={mi.icon} className="h-4 w-4" />
                                        {mi.name_es}
                                      </span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>

                  {Object.keys(itemMappings).length > 0 && (
                    <div className="mt-4 flex justify-end">
                      <Button onClick={handleSaveMappings} disabled={saving} className="gap-2">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        Guardar {Object.keys(itemMappings).length} mapeos
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500" />
                  <p>Todas las industrias de companies estan mapeadas</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Documents Tab */}
        <TabsContent value="documents" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Tags de Documentos sin Mapear</CardTitle>
              <CardDescription>
                Asigna cada tag de industria a una categoria maestra
              </CardDescription>
            </CardHeader>
            <CardContent>
              {filteredUnmapped.length > 0 ? (
                <>
                  {selectedItems.size > 0 && (
                    <div className="flex items-center gap-4 mb-4 p-3 bg-muted/50 rounded-lg">
                      <span className="text-sm font-medium">{selectedItems.size} seleccionados</span>
                      <Select value={bulkMasterIndustry} onValueChange={setBulkMasterIndustry}>
                        <SelectTrigger className="w-[200px]">
                          <SelectValue placeholder="Asignar a..." />
                        </SelectTrigger>
                        <SelectContent>
                          {masterIndustries.map(mi => (
                            <SelectItem key={mi.id} value={mi.id}>
                              <span className="flex items-center gap-2">
                                <IndustryIcon name={mi.icon} className="h-4 w-4" />
                                {mi.name_es}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button onClick={handleSaveMappings} disabled={saving} className="gap-2">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        Guardar
                      </Button>
                    </div>
                  )}

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">
                          <Checkbox
                            checked={selectedItems.size === filteredUnmapped.length && filteredUnmapped.length > 0}
                            onCheckedChange={handleSelectAll}
                          />
                        </TableHead>
                        <TableHead>Tag Original</TableHead>
                        <TableHead className="text-center">Documentos</TableHead>
                        <TableHead className="w-[250px]">Asignar a</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUnmapped.map(item => {
                        const key = `${item.sourceType}:${item.originalValue}`
                        return (
                          <TableRow key={key}>
                            <TableCell>
                              <Checkbox
                                checked={selectedItems.has(key)}
                                onCheckedChange={(checked) => handleSelectItem(key, !!checked)}
                              />
                            </TableCell>
                            <TableCell className="font-medium">{item.originalValue}</TableCell>
                            <TableCell className="text-center">
                              <Badge variant="secondary">{item.count}</Badge>
                            </TableCell>
                            <TableCell>
                              <Select
                                value={itemMappings[key] || ""}
                                onValueChange={(val) => handleIndividualMapping(item, val)}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Seleccionar..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {masterIndustries.map(mi => (
                                    <SelectItem key={mi.id} value={mi.id}>
                                      <span className="flex items-center gap-2">
                                        <IndustryIcon name={mi.icon} className="h-4 w-4" />
                                        {mi.name_es}
                                      </span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>

                  {Object.keys(itemMappings).length > 0 && (
                    <div className="mt-4 flex justify-end">
                      <Button onClick={handleSaveMappings} disabled={saving} className="gap-2">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        Guardar {Object.keys(itemMappings).length} mapeos
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500" />
                  <p>Todos los tags de documentos estan mapeados</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Master Industries Tab */}
        <TabsContent value="master" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Industrias Maestras</CardTitle>
              <CardDescription>
                Las 25 categorias maestras para normalizar industrias
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Industria</TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead className="text-center">Companies</TableHead>
                    <TableHead className="text-center">Documentos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {masterIndustries.map((mi, idx) => (
                    <TableRow key={mi.id}>
                      <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-muted">
                            <IndustryIcon name={mi.icon} className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="font-medium">{mi.name_es}</p>
                            <p className="text-xs text-muted-foreground">{mi.name_en}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{mi.id}</code>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{mi.companyCount.toLocaleString()}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{mi.documentCount}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
