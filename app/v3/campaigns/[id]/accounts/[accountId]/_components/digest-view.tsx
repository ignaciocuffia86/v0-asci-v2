"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { format, formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"
import { 
  Building2, 
  Globe, 
  Linkedin, 
  Users,
  Calendar,
  MapPin,
  ExternalLink,
  Newspaper,
  Cpu,
  Sparkles,
  TrendingUp,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
  Briefcase,
  Mail,
  AlertCircle
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import type { CampaignAccountDigest } from "@/lib/v3/digest"
import { ProspectionActions } from "./prospection-actions"

interface Company {
  id: string
  name: string
  domain: string | null
  industry: string | null
  linkedin_url: string | null
  logo_url: string | null
  description: string | null
  employee_count: number | null
  founded_year: number | null
  headquarters: string | null
}

interface CampaignAccount {
  id: string
  company_id: string
  status: string
  prospection_status: string | null
  tech_radar_run_at: string | null
  apollo_run_at: string | null
  added_at: string
  companies: Company | null
}

interface V2Signal {
  id: string
  title: string
  content: string | null
  signal_type: string
  created_at: string
}

interface V2News {
  id: string
  title: string
  summary: string | null
  source_url: string | null
  published_at: string | null
}

interface DigestViewProps {
  campaignAccount: CampaignAccount
  digest: CampaignAccountDigest | null
  campaignId: string
  campaignName?: string
  v2Signals?: V2Signal[]
  v2News?: V2News[]
}

export function DigestView({ campaignAccount, digest, campaignId, campaignName, v2Signals = [], v2News = [] }: DigestViewProps) {
  const router = useRouter()
  const [newsOpen, setNewsOpen] = useState(true)
  const [techOpen, setTechOpen] = useState(true)
  const [contactsOpen, setContactsOpen] = useState(true)
  const [signalsOpen, setSignalsOpen] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  
  const company = campaignAccount.companies
  const news = digest?.news || []
  const implementations = digest?.implementations || []
  const contacts = digest?.contacts || []
  const signals = digest?.signals || []
  
  // Combinar noticias de v3 digest y v2
  const allNews = [...news, ...v2News.map(n => ({
    id: n.id,
    title: n.title,
    summary: n.summary,
    source_url: n.source_url,
    published_at: n.published_at,
    source_name: null,
    sentiment: null
  }))].sort((a, b) => {
    if (!a.published_at) return 1
    if (!b.published_at) return -1
    return new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
  })
  
  // Extraer tipos de señales para el cloud tag
  const signalTypes = [...new Set(v2Signals.map(s => s.signal_type))].filter(Boolean)
  
  // Fecha de última actualización
  const lastUpdate = [
    campaignAccount.tech_radar_run_at,
    campaignAccount.apollo_run_at,
    ...v2News.map(n => n.published_at).filter(Boolean)
  ].filter(Boolean).sort().reverse()[0]
  
  const handleRefreshDigest = async () => {
    setRefreshing(true)
    try {
      // Refresh the page to reload data
      router.refresh()
      await new Promise(resolve => setTimeout(resolve, 500))
    } finally {
      setRefreshing(false)
    }
  }
  
  const handleDataRefresh = () => {
    router.refresh()
  }
  
  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <a href="/v3/docs" className="hover:text-foreground transition-colors">
          Documentos
        </a>
        <span>/</span>
        <a href="/v3/campaigns" className="hover:text-foreground transition-colors">
          Campañas
        </a>
        <span>/</span>
        <a href={`/v3/campaigns/${campaignId}`} className="hover:text-foreground transition-colors">
          {campaignName || "Campaña"}
        </a>
        <span>/</span>
        <span className="text-foreground font-medium">{company?.name || "Cuenta"}</span>
      </nav>

      {/* Company Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          {/* Company Logo */}
          <div className={cn(
            "flex size-16 shrink-0 items-center justify-center rounded-lg text-2xl font-semibold",
            "bg-primary/10 text-primary"
          )}>
            {company?.logo_url ? (
              <img 
                src={company.logo_url} 
                alt={company.name}
                className="size-16 rounded-lg object-cover"
              />
            ) : (
              company?.name?.charAt(0).toUpperCase() || "?"
            )}
          </div>
          
          {/* Company Info */}
          <div className="space-y-1">
            <h1 className="text-2xl font-bold">{company?.name || "Sin nombre"}</h1>
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {company?.industry && (
                <span className="flex items-center gap-1">
                  <Building2 className="size-3.5" />
                  {company.industry}
                </span>
              )}
              {company?.employee_count && (
                <span className="flex items-center gap-1">
                  <Users className="size-3.5" />
                  {company.employee_count.toLocaleString()} empleados
                </span>
              )}
              {company?.headquarters && (
                <span className="flex items-center gap-1">
                  <MapPin className="size-3.5" />
                  {company.headquarters}
                </span>
              )}
              {company?.founded_year && (
                <span className="flex items-center gap-1">
                  <Calendar className="size-3.5" />
                  Fundada en {company.founded_year}
                </span>
              )}
            </div>
            
            {/* Links */}
            <div className="flex items-center gap-2 pt-1">
              {company?.domain && (
                <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" asChild>
                  <a href={`https://${company.domain}`} target="_blank" rel="noopener noreferrer">
                    <Globe className="size-3" />
                    {company.domain}
                  </a>
                </Button>
              )}
              {company?.linkedin_url && (
                <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" asChild>
                  <a href={company.linkedin_url} target="_blank" rel="noopener noreferrer">
                    <Linkedin className="size-3" />
                    LinkedIn
                  </a>
                </Button>
              )}
            </div>
          </div>
        </div>
        
        {/* Actions */}
        <div className="flex items-center gap-2">
          {company && (
            <ProspectionActions
              campaignAccountId={campaignAccount.id}
              companyName={company.name}
              companyId={company.id}
              techRadarRunAt={campaignAccount.tech_radar_run_at}
              apolloRunAt={campaignAccount.apollo_run_at}
              onDataRefresh={handleDataRefresh}
            />
          )}
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleRefreshDigest}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            <span className="ml-2 hidden sm:inline">Actualizar</span>
          </Button>
        </div>
      </div>
      
      {company?.description && (
        <p className="text-sm text-muted-foreground">{company.description}</p>
      )}
      
      {/* Last Update Info */}
      {lastUpdate && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Calendar className="size-3" />
          <span suppressHydrationWarning>
            Última actualización: {formatDistanceToNow(new Date(lastUpdate), { addSuffix: true, locale: es })}
          </span>
        </div>
      )}
      
      <Separator />
      
      {/* Stats Bar */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-blue-500/10 p-2">
              <Newspaper className="size-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{allNews.length}</p>
              <p className="text-xs text-muted-foreground">Noticias</p>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-purple-500/10 p-2">
              <Cpu className="size-5 text-purple-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{implementations.length}</p>
              <p className="text-xs text-muted-foreground">Tecnologías</p>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-green-500/10 p-2">
              <Users className="size-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{contacts.length}</p>
              <p className="text-xs text-muted-foreground">Decision Makers</p>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-lg bg-amber-500/10 p-2">
              <TrendingUp className="size-5 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{v2Signals.length}</p>
              <p className="text-xs text-muted-foreground">Señales</p>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Signal Types Cloud Tag */}
      {signalTypes.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="size-5 text-amber-500" />
              <CardTitle className="text-base">Tipos de Señales Detectadas</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {signalTypes.map((type) => (
              <Badge key={type} variant="secondary" className="text-sm">
                {type.replace(/_/g, ' ')}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}
      
      {/* Empty State - Auto trigger search */}
      {allNews.length === 0 && implementations.length === 0 && contacts.length === 0 && v2Signals.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-4 py-12">
            <div className="rounded-full bg-muted p-4">
              <Loader2 className="size-8 text-muted-foreground animate-spin" />
            </div>
            <div className="text-center">
              <h3 className="font-semibold">Buscando información</h3>
              <p className="text-sm text-muted-foreground">
                Estamos recopilando noticias, tecnologías y señales para {company?.name || "esta empresa"}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* News Timeline Section */}
      {allNews.length > 0 && (
        <Collapsible open={newsOpen} onOpenChange={setNewsOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-accent/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Newspaper className="size-5 text-blue-500" />
                    <CardTitle className="text-base">Timeline de Noticias</CardTitle>
                    <Badge variant="secondary">{allNews.length}</Badge>
                  </div>
                  {newsOpen ? (
                    <ChevronDown className="size-5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-5 text-muted-foreground" />
                  )}
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                <div className="relative border-l-2 border-border pl-6 space-y-6">
                  {allNews.slice(0, 15).map((item, index) => (
                    <div key={item.id} className="relative">
                      {/* Timeline dot */}
                      <div className="absolute -left-[31px] size-4 rounded-full bg-blue-500 border-2 border-background" />
                      
                      <div className="rounded-lg border border-border p-3 hover:bg-accent/30">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 space-y-1">
                            <a 
                              href={item.source_url || '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium hover:underline"
                            >
                              {item.title}
                            </a>
                            {item.summary && (
                              <p className="text-sm text-muted-foreground line-clamp-2">
                                {item.summary}
                              </p>
                            )}
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              {item.published_at && (
                                <span suppressHydrationWarning>
                                  {format(new Date(item.published_at), "d MMM yyyy", { locale: es })}
                                </span>
                              )}
                              {item.source_name && (
                                <>
                                  <span>·</span>
                                  <span>{item.source_name}</span>
                                </>
                              )}
                            </div>
                          </div>
                          {item.source_url && (
                            <Button variant="ghost" size="icon" className="shrink-0" asChild>
                              <a href={item.source_url} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="size-4" />
                              </a>
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}
      
      {/* Tech Implementations Section */}
      {implementations.length > 0 && (
        <Collapsible open={techOpen} onOpenChange={setTechOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-accent/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Cpu className="size-5 text-purple-500" />
                    <CardTitle className="text-base">Tecnologias Detectadas</CardTitle>
                    <Badge variant="secondary">{implementations.length}</Badge>
                  </div>
                  {techOpen ? (
                    <ChevronDown className="size-5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-5 text-muted-foreground" />
                  )}
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="grid gap-3 pt-0 sm:grid-cols-2">
                {implementations.slice(0, 12).map((impl) => (
                  <div 
                    key={impl.id}
                    className="flex items-start gap-3 rounded-lg border border-border p-3"
                  >
                    <div className="rounded-md bg-purple-500/10 p-2">
                      <Cpu className="size-4 text-purple-500" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{impl.technology_name}</span>
                        {impl.confidence_score && impl.confidence_score > 0.8 && (
                          <Badge variant="outline" className="text-xs">Alta confianza</Badge>
                        )}
                      </div>
                      {impl.technology_category && (
                        <p className="text-xs text-muted-foreground">{impl.technology_category}</p>
                      )}
                      {impl.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2">{impl.description}</p>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}
      
      {/* Decision Makers Section */}
      {contacts.length > 0 && (
        <Collapsible open={contactsOpen} onOpenChange={setContactsOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-accent/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-5 text-green-500" />
                    <CardTitle className="text-base">Decision Makers</CardTitle>
                    <Badge variant="secondary">{contacts.length}</Badge>
                  </div>
                  {contactsOpen ? (
                    <ChevronDown className="size-5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-5 text-muted-foreground" />
                  )}
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="grid gap-3 pt-0 sm:grid-cols-2">
                {contacts.slice(0, 10).map((contact) => (
                  <div 
                    key={contact.id}
                    className="flex items-start gap-3 rounded-lg border border-border p-3"
                  >
                    {/* Avatar */}
                    <div className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-medium",
                      "bg-green-500/10 text-green-600"
                    )}>
                      {contact.photo_url ? (
                        <img 
                          src={contact.photo_url}
                          alt={contact.full_name}
                          className="size-10 rounded-full object-cover"
                        />
                      ) : (
                        contact.first_name?.charAt(0) || "?"
                      )}
                    </div>
                    
                    {/* Contact Info */}
                    <div className="flex-1 space-y-1">
                      <div className="font-medium">{contact.full_name}</div>
                      {contact.title && (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Briefcase className="size-3" />
                          {contact.title}
                        </div>
                      )}
                      <div className="flex items-center gap-2 pt-1">
                        {contact.email && (
                          <Button variant="ghost" size="icon" className="size-7" asChild>
                            <a href={`mailto:${contact.email}`}>
                              <Mail className="size-3.5" />
                            </a>
                          </Button>
                        )}
                        {contact.linkedin_url && (
                          <Button variant="ghost" size="icon" className="size-7" asChild>
                            <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer">
                              <Linkedin className="size-3.5" />
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                    
                    {/* Seniority Badge */}
                    {contact.seniority && (
                      <Badge variant="outline" className="shrink-0 text-xs">
                        {contact.seniority}
                      </Badge>
                    )}
                  </div>
                ))}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}
    </div>
  )
}
