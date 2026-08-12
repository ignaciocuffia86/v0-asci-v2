"use client"

import React from "react"
import { Building2, MapPin, Users, GraduationCap, Flame } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { ScoreTooltip } from "@/components/search/score-tooltip"
import type { ProcessSearchResult, TechnologySearchResult } from "@/app/actions/search-v2"

interface ResultItemProps {
  company: ProcessSearchResult | TechnologySearchResult
  isSelected: boolean
  onToggleSelect: (companyId: string) => void
  onOpenDrawer: (companyId: string) => void
}

// The custom comparator should return true if props are equal (no re-render needed)
// Return false if props are different (re-render needed)
const arePropsEqual = (prevProps: ResultItemProps, nextProps: ResultItemProps) => {
  // Return true if EVERYTHING is the same (don't re-render)
  // Return false if ANYTHING is different (re-render)
  return (
    prevProps.company.company_id === nextProps.company.company_id &&
    prevProps.company.relevance_score === nextProps.company.relevance_score &&
    prevProps.company.current_count === nextProps.company.current_count &&
    prevProps.company.alumni_count === nextProps.company.alumni_count &&
    prevProps.company.job_postings_count === nextProps.company.job_postings_count &&
    prevProps.company.company_name === nextProps.company.company_name &&
    prevProps.company.company_logo_url === nextProps.company.company_logo_url &&
    prevProps.isSelected === nextProps.isSelected
  )
}

// Update the React.memo to use the corrected comparator
export const ResultItem = React.memo(
  ({ company, isSelected, onToggleSelect, onOpenDrawer }: ResultItemProps) => (
    <div className="bg-card border rounded-lg p-6 hover:border-primary/50 transition-colors">
      <div className="flex items-start gap-4">
        <div className="flex items-start pt-1">
          <Checkbox
            id={`company-${company.company_id}`}
            checked={isSelected}
            onCheckedChange={() => onToggleSelect(company.company_id)}
          />
        </div>

        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onOpenDrawer(company.company_id)}>
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-muted rounded-md flex items-center justify-center flex-shrink-0 overflow-hidden">
              {company.company_logo_url ? (
                <img
                  src={company.company_logo_url || "/placeholder.svg"}
                  alt={company.company_name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <Building2 className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-lg">{company.company_name}</h3>
              <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                {company.company_country && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {company.company_country}
                  </span>
                )}
                {company.company_industry && <span className="truncate">{company.company_industry}</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-center border-r pr-6">
            <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Score</div>
            <ScoreTooltip
              totalScore={company.relevance_score}
              currentScore={company.current_score}
              alumniScore={company.alumni_score}
              jobPostingsScore={company.job_postings_score}
              currentCount={company.current_count}
              alumniCount={company.alumni_count}
              jobPostingsCount={company.job_postings_count}
            />
          </div>

          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-primary font-bold text-2xl">
              <Users className="h-5 w-5" />
              {company.current_count}
            </div>
            <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Actuales</div>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-muted-foreground font-bold text-2xl">
              <GraduationCap className="h-5 w-5" />
              {company.alumni_count}
            </div>
            <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Alumni</div>
          </div>
          {company.job_postings_count > 0 && (
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-orange-600 font-bold text-2xl">
                <Flame className="h-5 w-5" />
                {company.job_postings_count}
              </div>
              <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Búsquedas</div>
            </div>
          )}
        </div>
      </div>
    </div>
  ),
  arePropsEqual,
)

ResultItem.displayName = "ResultItem"

export default ResultItem
