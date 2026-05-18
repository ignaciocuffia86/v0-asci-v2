"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { 
  Building2, 
  Loader2, 
  Plus,
  Sparkles,
  FileUp,
  AlertCircle
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { getCampaignAccounts } from "@/app/actions/v3/campaigns"

interface Account {
  id: string
  company_id: string
  status: string
  prospection_status: string | null
  companies: {
    id: string
    name: string
    domain: string | null
    industry: string | null
    logo_url: string | null
  } | null
  digest?: {
    new_items_count: number
    signal_types_matched: string[]
    contact_ids: string[]
  } | null
}

interface AccountListSidebarProps {
  campaignId: string
}

export function AccountListSidebar({ campaignId }: AccountListSidebarProps) {
  const pathname = usePathname()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingImports, setPendingImports] = useState(0)
  
  useEffect(() => {
    async function loadAccounts() {
      setLoading(true)
      try {
        const result = await getCampaignAccounts(campaignId)
        if (Array.isArray(result)) {
          setAccounts(result as unknown as Account[])
        }
        // TODO: Check for pending imports
      } catch (error) {
        console.error("Error loading accounts:", error)
      } finally {
        setLoading(false)
      }
    }
    
    loadAccounts()
  }, [campaignId])
  
  // Extract account ID from pathname if viewing a specific account
  const currentAccountId = pathname.match(/\/accounts\/([^/]+)/)?.[1]
  
  if (loading) {
    return (
      <div className="flex flex-col gap-1 p-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-md p-2">
            <Skeleton className="size-9 rounded-md" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        ))}
      </div>
    )
  }
  
  if (accounts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="rounded-full bg-muted p-3">
          <Building2 className="size-6 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">Sin cuentas</p>
          <p className="text-xs text-muted-foreground">
            Agrega cuentas para empezar a monitorear
          </p>
        </div>
        <div className="flex flex-col gap-2 w-full">
          <Button size="sm" className="w-full gap-2" asChild>
            <Link href={`/v3/campaigns/${campaignId}?add=true`}>
              <Plus className="size-4" />
              Agregar cuenta
            </Link>
          </Button>
          <Button size="sm" variant="outline" className="w-full gap-2" asChild>
            <Link href={`/v3/campaigns/${campaignId}?import=true`}>
              <FileUp className="size-4" />
              Importar CSV
            </Link>
          </Button>
        </div>
      </div>
    )
  }
  
  return (
    <div className="flex flex-col">
      {/* Pending Imports Alert */}
      {pendingImports > 0 && (
        <Link 
          href={`/v3/campaigns/${campaignId}/import`}
          className="m-2 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-600 hover:bg-amber-500/20"
        >
          <AlertCircle className="size-4" />
          <span>{pendingImports} imports pendientes de revision</span>
        </Link>
      )}
      
      {/* Account List */}
      <div className="flex flex-col gap-0.5 p-2">
        {accounts.map((account) => {
          const company = account.companies
          const isActive = currentAccountId === account.id
          const hasNewItems = (account.digest?.new_items_count || 0) > 0
          const hasContacts = (account.digest?.contact_ids?.length || 0) > 0
          
          return (
            <Link
              key={account.id}
              href={`/v3/campaigns/${campaignId}/accounts/${account.id}`}
              className={cn(
                "group flex items-center gap-3 rounded-md p-2 transition-colors",
                isActive 
                  ? "bg-accent text-accent-foreground" 
                  : "hover:bg-accent/50"
              )}
            >
              {/* Company Avatar */}
              <div className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-md text-sm font-medium",
                isActive 
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}>
                {company?.logo_url ? (
                  <img 
                    src={company.logo_url} 
                    alt={company.name}
                    className="size-9 rounded-md object-cover"
                  />
                ) : (
                  company?.name?.charAt(0).toUpperCase() || "?"
                )}
              </div>
              
              {/* Company Info */}
              <div className="flex-1 truncate">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {company?.name || "Sin nombre"}
                  </span>
                  {hasNewItems && (
                    <Badge 
                      variant="default" 
                      className="h-5 min-w-5 justify-center px-1.5 text-xs"
                    >
                      {account.digest?.new_items_count}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="truncate">
                    {company?.industry || company?.domain || "Sin industria"}
                  </span>
                  {hasContacts && (
                    <>
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        <Sparkles className="size-3" />
                        {account.digest?.contact_ids?.length} DMs
                      </span>
                    </>
                  )}
                </div>
              </div>
            </Link>
          )
        })}
      </div>
      
      {/* Add More */}
      <div className="border-t border-border p-2">
        <Button 
          variant="ghost" 
          size="sm" 
          className="w-full justify-start gap-2 text-muted-foreground"
          asChild
        >
          <Link href={`/v3/campaigns/${campaignId}?add=true`}>
            <Plus className="size-4" />
            Agregar cuenta
          </Link>
        </Button>
      </div>
    </div>
  )
}
