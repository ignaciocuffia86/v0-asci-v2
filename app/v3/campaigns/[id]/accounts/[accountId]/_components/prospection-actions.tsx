"use client"

import { useState } from "react"
import { Cpu, Users, Loader2, Search, Check, X, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Checkbox } from "@/components/ui/checkbox"
import { toast } from "sonner"
import { runTechRadarForAccount, type TechRadarResult } from "@/app/actions/v3/tech-radar"
import { 
  getRecommendedJobTitles, 
  searchDecisionMakers,
  type ApolloSearchResult,
  type ApolloContact 
} from "@/app/actions/v3/apollo"

interface ProspectionActionsProps {
  campaignAccountId: string
  companyName: string
  companyId: string
  techRadarRunAt: string | null
  apolloRunAt: string | null
  onDataRefresh?: () => void
}

export function ProspectionActions({
  campaignAccountId,
  companyName,
  companyId,
  techRadarRunAt,
  apolloRunAt,
  onDataRefresh,
}: ProspectionActionsProps) {
  const [techRadarLoading, setTechRadarLoading] = useState(false)
  const [apolloDialogOpen, setApolloDialogOpen] = useState(false)
  
  const handleTechRadar = async () => {
    setTechRadarLoading(true)
    try {
      const result = await runTechRadarForAccount(campaignAccountId)
      
      if (result.success) {
        toast.success(`Tech Radar completado`, {
          description: `Se encontraron ${result.findings.length} implementaciones para ${companyName}`,
        })
        onDataRefresh?.()
      } else {
        toast.error("Error en Tech Radar", {
          description: result.error || "Error desconocido",
        })
      }
    } catch (error) {
      toast.error("Error en Tech Radar", {
        description: error instanceof Error ? error.message : "Error desconocido",
      })
    } finally {
      setTechRadarLoading(false)
    }
  }
  
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleTechRadar}
        disabled={techRadarLoading}
      >
        {techRadarLoading ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <Cpu className="mr-2 size-4" />
        )}
        Tech Radar
        {techRadarRunAt && (
          <Badge variant="secondary" className="ml-2 text-xs">
            Ejecutado
          </Badge>
        )}
      </Button>
      
      <ApolloSearchDialog
        open={apolloDialogOpen}
        onOpenChange={setApolloDialogOpen}
        campaignAccountId={campaignAccountId}
        companyName={companyName}
        companyId={companyId}
        onSearchComplete={onDataRefresh}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Apollo Search Dialog
// ---------------------------------------------------------------------------

interface ApolloSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  campaignAccountId: string
  companyName: string
  companyId: string
  onSearchComplete?: () => void
}

function ApolloSearchDialog({
  open,
  onOpenChange,
  campaignAccountId,
  companyName,
  companyId,
  onSearchComplete,
}: ApolloSearchDialogProps) {
  const [step, setStep] = useState<'titles' | 'searching' | 'results'>('titles')
  const [loadingTitles, setLoadingTitles] = useState(false)
  const [recommendedTitles, setRecommendedTitles] = useState<string[]>([])
  const [selectedTitles, setSelectedTitles] = useState<string[]>([])
  const [customTitle, setCustomTitle] = useState("")
  const [reasoning, setReasoning] = useState("")
  const [searchResult, setSearchResult] = useState<ApolloSearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  
  const loadRecommendations = async () => {
    setLoadingTitles(true)
    try {
      const result = await getRecommendedJobTitles(campaignAccountId)
      setRecommendedTitles(result.titles)
      setSelectedTitles(result.titles.slice(0, 5)) // Pre-select first 5
      setReasoning(result.reasoning)
    } catch (error) {
      toast.error("Error obteniendo recomendaciones")
    } finally {
      setLoadingTitles(false)
    }
  }
  
  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen)
    if (isOpen && recommendedTitles.length === 0) {
      loadRecommendations()
    }
    if (!isOpen) {
      // Reset state when closing
      setStep('titles')
      setSearchResult(null)
    }
  }
  
  const toggleTitle = (title: string) => {
    setSelectedTitles(prev => 
      prev.includes(title)
        ? prev.filter(t => t !== title)
        : [...prev, title]
    )
  }
  
  const addCustomTitle = () => {
    const trimmed = customTitle.trim()
    if (trimmed && !selectedTitles.includes(trimmed)) {
      setSelectedTitles(prev => [...prev, trimmed])
      setCustomTitle("")
    }
  }
  
  const handleSearch = async () => {
    if (selectedTitles.length === 0) {
      toast.error("Selecciona al menos un cargo")
      return
    }
    
    setStep('searching')
    setSearching(true)
    
    try {
      const result = await searchDecisionMakers(campaignAccountId, selectedTitles, {
        maxResults: 20,
      })
      
      setSearchResult(result)
      setStep('results')
      
      if (result.success) {
        toast.success(`Busqueda completada`, {
          description: `Se encontraron ${result.contacts.length} contactos`,
        })
        onSearchComplete?.()
      } else {
        toast.error("Error en busqueda", {
          description: result.error,
        })
      }
    } catch (error) {
      toast.error("Error en busqueda Apollo")
      setStep('titles')
    } finally {
      setSearching(false)
    }
  }
  
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Users className="mr-2 size-4" />
          Buscar DMs
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Buscar Decision Makers en Apollo</DialogTitle>
          <DialogDescription>
            {companyName} - Selecciona los cargos que quieres buscar
          </DialogDescription>
        </DialogHeader>
        
        {step === 'titles' && (
          <>
            {loadingTitles ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">
                  Cargando recomendaciones...
                </span>
              </div>
            ) : (
              <div className="space-y-4">
                {reasoning && (
                  <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3">
                    <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
                    <p className="text-sm text-muted-foreground">{reasoning}</p>
                  </div>
                )}
                
                <div>
                  <Label className="text-sm font-medium">Cargos recomendados</Label>
                  <ScrollArea className="mt-2 h-[200px] rounded-md border p-2">
                    <div className="space-y-2">
                      {recommendedTitles.map((title) => (
                        <div key={title} className="flex items-center gap-2">
                          <Checkbox
                            id={title}
                            checked={selectedTitles.includes(title)}
                            onCheckedChange={() => toggleTitle(title)}
                          />
                          <label
                            htmlFor={title}
                            className="cursor-pointer text-sm"
                          >
                            {title}
                          </label>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
                
                <div>
                  <Label className="text-sm font-medium">Agregar cargo personalizado</Label>
                  <div className="mt-2 flex gap-2">
                    <Input
                      placeholder="Ej: VP of Engineering"
                      value={customTitle}
                      onChange={(e) => setCustomTitle(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addCustomTitle()}
                    />
                    <Button variant="outline" onClick={addCustomTitle}>
                      Agregar
                    </Button>
                  </div>
                </div>
                
                {selectedTitles.length > 0 && (
                  <div>
                    <Label className="text-sm font-medium">
                      Seleccionados ({selectedTitles.length})
                    </Label>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {selectedTitles.map((title) => (
                        <Badge
                          key={title}
                          variant="secondary"
                          className="cursor-pointer"
                          onClick={() => toggleTitle(title)}
                        >
                          {title}
                          <X className="ml-1 size-3" />
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSearch} disabled={selectedTitles.length === 0}>
                <Search className="mr-2 size-4" />
                Buscar ({selectedTitles.length} cargos)
              </Button>
            </DialogFooter>
          </>
        )}
        
        {step === 'searching' && (
          <div className="flex flex-col items-center justify-center gap-4 py-12">
            <Loader2 className="size-8 animate-spin text-primary" />
            <div className="text-center">
              <p className="font-medium">Buscando en Apollo...</p>
              <p className="text-sm text-muted-foreground">
                Esto puede tomar unos segundos
              </p>
            </div>
          </div>
        )}
        
        {step === 'results' && searchResult && (
          <>
            <div className="space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-3 gap-4">
                <Card>
                  <CardContent className="p-3 text-center">
                    <p className="text-2xl font-bold">{searchResult.stats.totalFound}</p>
                    <p className="text-xs text-muted-foreground">Encontrados</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3 text-center">
                    <p className="text-2xl font-bold">{searchResult.stats.enriched}</p>
                    <p className="text-xs text-muted-foreground">Enriquecidos</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3 text-center">
                    <p className="text-2xl font-bold">{searchResult.stats.saved}</p>
                    <p className="text-xs text-muted-foreground">Guardados</p>
                  </CardContent>
                </Card>
              </div>
              
              {searchResult.stats.fromCache && (
                <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                  Resultados obtenidos del cache
                </div>
              )}
              
              {/* Contacts */}
              <ScrollArea className="h-[300px]">
                <div className="space-y-2">
                  {searchResult.contacts.map((contact) => (
                    <ContactCard key={contact.id} contact={contact} />
                  ))}
                  
                  {searchResult.contacts.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <Users className="size-8 text-muted-foreground" />
                      <p className="mt-2 font-medium">Sin resultados</p>
                      <p className="text-sm text-muted-foreground">
                        No se encontraron contactos con los cargos seleccionados
                      </p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('titles')}>
                Nueva busqueda
              </Button>
              <Button onClick={() => onOpenChange(false)}>
                <Check className="mr-2 size-4" />
                Listo
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Contact Card
// ---------------------------------------------------------------------------

function ContactCard({ contact }: { contact: ApolloContact }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      {/* Avatar */}
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
        {contact.photoUrl ? (
          <img
            src={contact.photoUrl}
            alt={contact.name}
            className="size-full rounded-full object-cover"
          />
        ) : (
          contact.firstName?.charAt(0) || contact.name.charAt(0)
        )}
      </div>
      
      {/* Info */}
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{contact.name}</span>
          {contact.seniority && (
            <Badge variant="outline" className="text-xs">
              {contact.seniority}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{contact.title}</p>
        
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {contact.email && (
            <a
              href={`mailto:${contact.email}`}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <span className="max-w-[150px] truncate">{contact.email}</span>
            </a>
          )}
          {contact.linkedinUrl && (
            <a
              href={contact.linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              LinkedIn
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
