"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { 
  ChevronDown, 
  Plus, 
  Settings, 
  Building2,
  Radio,
  Search,
  Crosshair,
  MessageSquare,
  Menu,
  X
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { AccountListSidebar } from "./account-list-sidebar"
import { CopilotPanel } from "./copilot-panel"

interface Campaign {
  id: string
  name: string
  type: "monitorear" | "prospectar" | "descubrir"
  account_count: number
}

interface CampaignLayoutClientProps {
  campaigns: Campaign[]
  currentCampaignId: string
  children: React.ReactNode
}

const campaignTypeIcons = {
  monitorear: Radio,
  prospectar: Search,
  descubrir: Crosshair,
}

const campaignTypeLabels = {
  monitorear: "Monitoreo",
  prospectar: "Prospeccion",
  descubrir: "Descubrimiento",
}

export function CampaignLayoutClient({
  campaigns,
  currentCampaignId,
  children
}: CampaignLayoutClientProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [copilotOpen, setCopilotOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  
  const currentCampaign = campaigns.find(c => c.id === currentCampaignId)
  const CampaignIcon = currentCampaign ? campaignTypeIcons[currentCampaign.type] : Radio
  
  // Check for mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener("resize", checkMobile)
    return () => window.removeEventListener("resize", checkMobile)
  }, [])
  
  // Close sidebar on mobile when navigating
  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false)
    }
  }, [pathname, isMobile])
  
  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar - Account List */}
      <aside 
        className={cn(
          "flex flex-col border-r border-border bg-card transition-all duration-200",
          sidebarOpen ? "w-72" : "w-0",
          isMobile && sidebarOpen && "fixed inset-y-0 left-0 z-50 w-72 shadow-lg"
        )}
      >
        {sidebarOpen && (
          <>
            {/* Campaign Selector Header */}
            <div className="flex items-center justify-between border-b border-border p-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="flex-1 justify-between gap-2 px-2">
                    <div className="flex items-center gap-2 truncate">
                      <CampaignIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate font-medium">
                        {currentCampaign?.name || "Seleccionar"}
                      </span>
                    </div>
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  {campaigns.map((campaign) => {
                    const Icon = campaignTypeIcons[campaign.type]
                    return (
                      <DropdownMenuItem
                        key={campaign.id}
                        onClick={() => router.push(`/v3/campaigns/${campaign.id}`)}
                        className={cn(
                          campaign.id === currentCampaignId && "bg-accent"
                        )}
                      >
                        <Icon className="mr-2 size-4" />
                        <span className="flex-1 truncate">{campaign.name}</span>
                        <Badge variant="secondary" className="ml-2">
                          {campaign.account_count}
                        </Badge>
                      </DropdownMenuItem>
                    )
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => router.push("/v3/campaigns/new")}>
                    <Plus className="mr-2 size-4" />
                    Nueva campana
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push("/v3/campaigns")}>
                    <Settings className="mr-2 size-4" />
                    Gestionar campanas
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              
              {isMobile && (
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => setSidebarOpen(false)}
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
            
            {/* Account List */}
            <ScrollArea className="flex-1">
              <AccountListSidebar campaignId={currentCampaignId} />
            </ScrollArea>
            
            {/* Campaign Type Badge */}
            {currentCampaign && (
              <div className="border-t border-border p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-xs">
                    {campaignTypeLabels[currentCampaign.type]}
                  </Badge>
                  <span>{currentCampaign.account_count} cuentas</span>
                </div>
              </div>
            )}
          </>
        )}
      </aside>
      
      {/* Mobile Overlay */}
      {isMobile && sidebarOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/50"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      
      {/* Main Content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="flex h-14 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2">
            {!sidebarOpen && (
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => setSidebarOpen(true)}
              >
                <Menu className="size-4" />
              </Button>
            )}
            <Link href="/v3" className="flex items-center gap-2">
              <Building2 className="size-5 text-primary" />
              <span className="font-semibold">ASCI</span>
            </Link>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant={copilotOpen ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setCopilotOpen(!copilotOpen)}
              className="gap-2"
            >
              <MessageSquare className="size-4" />
              <span className="hidden sm:inline">Copilot</span>
            </Button>
            <Button variant="ghost" size="icon" asChild>
              <Link href="/v3/settings">
                <Settings className="size-4" />
              </Link>
            </Button>
          </div>
        </header>
        
        {/* Content Area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Main Panel */}
          <div className="flex-1 overflow-auto">
            {children}
          </div>
          
          {/* Copilot Panel */}
          {copilotOpen && (
            <aside className="w-80 border-l border-border bg-card">
              <CopilotPanel onClose={() => setCopilotOpen(false)} />
            </aside>
          )}
        </div>
      </main>
    </div>
  )
}
