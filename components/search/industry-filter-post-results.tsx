"use client"

import { useState } from "react"
// Industry filter component for post-search filtering
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { ChevronDown, ChevronUp, Factory, X } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

type IndustryOption = {
  id: string
  name_es: string
  count: number
}

interface IndustryFilterPostResultsProps {
  industries: IndustryOption[]
  selectedIds: string[]
  onSelectionChange: (ids: string[]) => void
  totalResults: number
  filteredResults: number
}

export function IndustryFilterPostResults({
  industries,
  selectedIds,
  onSelectionChange,
  totalResults,
  filteredResults,
}: IndustryFilterPostResultsProps) {
  const [isOpen, setIsOpen] = useState(false)

  const toggleIndustry = (id: string) => {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter(i => i !== id))
    } else {
      onSelectionChange([...selectedIds, id])
    }
  }

  const clearAll = () => {
    onSelectionChange([])
  }

  const selectedIndustryNames = industries
    .filter(i => selectedIds.includes(i.id))
    .map(i => i.name_es)

  return (
    <Card className="p-4">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-center justify-between">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 p-0 h-auto hover:bg-transparent">
              <Factory className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Filtrar por Industria</span>
              <Badge variant="secondary" className="ml-1">
                {industries.length}
              </Badge>
              {isOpen ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </Button>
          </CollapsibleTrigger>

          {selectedIds.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {filteredResults} de {totalResults} empresas
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                className="h-auto py-1 px-2 text-xs"
              >
                Limpiar filtros
                <X className="h-3 w-3 ml-1" />
              </Button>
            </div>
          )}
        </div>

        {/* Show selected industries as badges when collapsed */}
        {!isOpen && selectedIds.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {selectedIndustryNames.map(name => (
              <Badge key={name} variant="default" className="text-xs">
                {name}
              </Badge>
            ))}
          </div>
        )}

        <CollapsibleContent className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {industries.map(industry => (
              <label
                key={industry.id}
                className="flex items-center gap-2 p-2 rounded-md hover:bg-muted cursor-pointer transition-colors"
              >
                <Checkbox
                  checked={selectedIds.includes(industry.id)}
                  onCheckedChange={() => toggleIndustry(industry.id)}
                />
                <span className="text-sm flex-1">{industry.name_es}</span>
                <Badge variant="outline" className="text-xs">
                  {industry.count}
                </Badge>
              </label>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
