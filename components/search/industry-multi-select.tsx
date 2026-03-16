"use client"

import { useState, useMemo } from "react"
import { Check, ChevronDown, Factory, X, Loader2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  Monitor,
  Landmark,
  Building2,
  Shield,
  Heart,
  GraduationCap,
  ShoppingCart,
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
  Layers,
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

export interface IndustryOption {
  id: string
  name_es: string
  name_en: string
  icon: string
  company_count: number
}

interface IndustryMultiSelectProps {
  industries: IndustryOption[]
  selectedIds: string[]
  onSelectionChange: (ids: string[]) => void
  isLoading?: boolean
  disabled?: boolean
  placeholder?: string
}

export function IndustryMultiSelect({
  industries,
  selectedIds,
  onSelectionChange,
  isLoading = false,
  disabled = false,
  placeholder = "Filtrar por industria...",
}: IndustryMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")

  const selectedIndustries = useMemo(() => {
    return industries.filter((i) => selectedIds.includes(i.id))
  }, [industries, selectedIds])

  const filteredIndustries = useMemo(() => {
    if (!searchQuery) return industries
    const query = searchQuery.toLowerCase()
    return industries.filter(
      (ind) =>
        ind.name_es.toLowerCase().includes(query) ||
        ind.name_en.toLowerCase().includes(query)
    )
  }, [industries, searchQuery])

  const handleSelect = (industryId: string) => {
    if (selectedIds.includes(industryId)) {
      onSelectionChange(selectedIds.filter((id) => id !== industryId))
    } else {
      onSelectionChange([...selectedIds, industryId])
    }
  }

  const handleRemove = (industryId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    onSelectionChange(selectedIds.filter((id) => id !== industryId))
  }

  const handleClearAll = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelectionChange([])
  }

  if (isLoading) {
    return (
      <Button
        variant="outline"
        className="w-full justify-start text-muted-foreground"
        disabled
      >
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Cargando industrias...
      </Button>
    )
  }

  if (industries.length === 0) {
    return null
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between min-h-10 h-auto"
          disabled={disabled}
        >
          <div className="flex flex-wrap gap-1 items-center flex-1">
            {selectedIndustries.length === 0 ? (
              <span className="text-muted-foreground flex items-center gap-2">
                <Factory className="h-4 w-4" />
                {placeholder}
              </span>
            ) : (
              <>
                {selectedIndustries.slice(0, 2).map((industry) => (
                  <Badge
                    key={industry.id}
                    variant="secondary"
                    className="flex items-center gap-1 pr-1"
                  >
                    <IndustryIcon name={industry.icon} className="h-3 w-3" />
                    <span className="max-w-24 truncate">{industry.name_es}</span>
                    <button
                      className="ml-1 rounded-full hover:bg-muted p-0.5"
                      onClick={(e) => handleRemove(industry.id, e)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {selectedIndustries.length > 2 && (
                  <Badge variant="secondary">
                    +{selectedIndustries.length - 2} más
                  </Badge>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-1 ml-2">
            {selectedIds.length > 0 && (
              <button
                className="p-1 hover:bg-muted rounded"
                onClick={handleClearAll}
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[350px] p-0" align="start">
        {/* Search input */}
        <div className="flex items-center border-b px-3 py-2">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Input
            placeholder="Buscar industria..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="border-0 p-0 h-8 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="ml-2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Industries list */}
        <div className="max-h-[300px] overflow-y-auto p-1">
          {filteredIndustries.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No se encontraron industrias
            </div>
          ) : (
            filteredIndustries.map((industry) => {
              const isSelected = selectedIds.includes(industry.id)
              return (
                <button
                  key={industry.id}
                  onClick={() => handleSelect(industry.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-sm rounded-sm",
                    "hover:bg-accent hover:text-accent-foreground",
                    "cursor-pointer transition-colors",
                    isSelected && "bg-accent/50"
                  )}
                >
                  <div
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded-sm border shrink-0",
                      isSelected
                        ? "bg-primary border-primary"
                        : "border-muted-foreground/30"
                    )}
                  >
                    {isSelected && (
                      <Check className="h-3 w-3 text-primary-foreground" />
                    )}
                  </div>
                  <div className="flex items-center justify-center w-6 h-6 rounded bg-muted shrink-0">
                    <IndustryIcon name={industry.icon} className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <span className="flex-1 text-left truncate">{industry.name_es}</span>
                  <Badge variant="outline" className="ml-2 text-xs shrink-0">
                    {industry.company_count.toLocaleString()}
                  </Badge>
                </button>
              )
            })
          )}
        </div>

        {/* Footer */}
        {selectedIds.length > 0 && (
          <div className="border-t px-3 py-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {selectedIds.length} {selectedIds.length === 1 ? "seleccionada" : "seleccionadas"}
            </span>
            <button
              onClick={() => onSelectionChange([])}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Limpiar
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
