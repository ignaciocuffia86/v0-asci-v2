"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import useSWR from "swr"
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
import Image from "next/image"

interface Account {
  id: string
  company_id: string
  status: string
  prospection_status: string | null
  company: {
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
  onAddAccount?: () => void
  onImportCsv?: () => void
  refreshKey?: number
}

export function AccountListSidebar({ campaignId, onAddAccount, onImportCsv, refreshKey = 0 }: AccountListSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [pendingImports, setPendingImports] = useState(0)

  // Use SWR for account list with auto-revalidation
  const { data: accounts = [], isLoading: loading, mutate } = useSWR(
    `campaign-accounts-${campaignId}`,
    async () => {
      const result = await getCampaignAccounts(campaignId)
      return Array.isArray(result) ? result as unknown as Account[] : []
    },
    {
      refreshInterval: 5000, // Poll every 5 seconds
      revalidateOnFocus: true,
    }
  )

  // Revalidate when refreshKey changes
  useEffect(() => {
    if (refreshKey > 0) {
      mutate()
    }
  }, [refreshKey, mutate])

  const handleAddAccount = () => {
    if (onAddAccount) {
      onAddAccount()
    } else {
      router.push(`/v3/campaigns/${campaignId}?add=true`)
    }
  }

  const handleImportCsv = () => {
    if (onImportCsv) {
      onImportCsv()
    } else {
      router.push(`/v3/campaigns/${campaignId}?import=true`)
    }
  }
  
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
          <Button size="sm" className="w-full gap-2" onClick={handleAddAccount}>
            <Plus className="size-4" />
            Agregar cuenta
          </Button>
          <Button size="sm" variant="outline" className="w-full gap-2" onClick={handleImportCsv}>
            <FileUp className="size-4" />
            Importar CSV
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
          const company = account.company
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
                "flex size-9 shrink-0 items-center justify-center rounded-md text-sm font-medium overflow-hidden",
                isActive 
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}>
                {company?.logo_url ? (
                  <Image 
                    src={company.logo_url} 
                    alt={company.name}
                    width={36}
                    height={36}
                    className="size-9 object-contain bg-white"
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
          onClick={handleAddAccount}
        >
          <Plus className="size-4" />
          Agregar cuenta
        </Button>
      </div>
    </div>
  )
}
