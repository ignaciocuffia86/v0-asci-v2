"use client"

import { useState, useEffect } from "react"
import { Check, ChevronDown, Factory, X, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
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
  const IconComponent = iconMap[name] || Factory
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

  const selectedIndustries = industries.filter((i) => selectedIds.includes(i.id))

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
        <Command>
          <CommandInput placeholder="Buscar industria..." />
          <CommandList>
            <CommandEmpty>No se encontraron industrias.</CommandEmpty>
            <CommandGroup>
              {industries.map((industry) => (
                <CommandItem
                  key={industry.id}
                  value={`${industry.name_es} ${industry.name_en}`}
                  onSelect={() => handleSelect(industry.id)}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded-sm border",
                        selectedIds.includes(industry.id)
                          ? "bg-primary border-primary"
                          : "border-muted-foreground"
                      )}
                    >
                      {selectedIds.includes(industry.id) && (
                        <Check className="h-3 w-3 text-primary-foreground" />
                      )}
                    </div>
                    <IndustryIcon name={industry.icon} className="h-4 w-4 text-muted-foreground" />
                    <span>{industry.name_es}</span>
                  </div>
                  <Badge variant="outline" className="ml-2 text-xs">
                    {industry.company_count.toLocaleString()}
                  </Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
