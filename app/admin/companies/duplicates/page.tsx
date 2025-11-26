"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { ArrowRight, Loader2, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react"
import { getPotentialDuplicates, mergeCompanies, autoMergeDuplicates } from "@/app/actions/companies"
import { toast } from "@/hooks/use-toast"

interface Company {
  id: string
  name: string
  linkedin_url: string | null
  created_at: string
}

interface DuplicateGroup {
  normalized_name: string
  count: number
  companies: Company[]
}

const MAX_COMPANIES_SHOWN = 10
const MAX_MERGE_BUTTONS = 5

export default function CompanyDuplicatesPage() {
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [hideUnknown, setHideUnknown] = useState(true)

  const fetchDuplicates = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getPotentialDuplicates()
      setDuplicates(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error fetching duplicates")
    } finally {
      setLoading(false)
    }
  }

  const handleAutoMerge = async () => {
    try {
      setProcessing(true)
      const result = await autoMergeDuplicates()
      toast({
        title: "Auto-merge complete",
        description: `Merged ${result.merged} company pairs`,
      })
      fetchDuplicates()
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to auto-merge duplicates",
        variant: "destructive",
      })
    } finally {
      setProcessing(false)
    }
  }

  const handleMerge = async (masterId: string, duplicateId: string) => {
    try {
      await mergeCompanies(masterId, duplicateId)
      toast({
        title: "Success",
        description: "Companies merged successfully",
      })
      fetchDuplicates()
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to merge companies",
        variant: "destructive",
      })
    }
  }

  const toggleExpanded = (name: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  useEffect(() => {
    fetchDuplicates()
  }, [])

  const filteredDuplicates = hideUnknown
    ? duplicates.filter((g) => g.normalized_name !== "unknown company")
    : duplicates

  const unknownCount = duplicates.find((g) => g.normalized_name === "unknown company")?.count || 0

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-8 text-center text-destructive">Error loading duplicates: {error}</CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Company Deduplication</h1>
        <div className="space-x-2">
          <Button onClick={fetchDuplicates} variant="outline" disabled={loading || processing}>
            Refresh
          </Button>
          <Button onClick={handleAutoMerge} disabled={loading || processing || filteredDuplicates.length === 0}>
            {processing ? "Processing..." : "Auto-Merge Safe Matches"}
          </Button>
        </div>
      </div>

      {unknownCount > 0 && (
        <Card className="border-amber-500/50 bg-amber-500/10">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <span>
                Hay <strong>{unknownCount}</strong> compañías sin nombre ("Unknown Company"). Estas requieren limpieza
                manual en la base de datos.
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={() => setHideUnknown(!hideUnknown)}>
              {hideUnknown ? "Mostrar" : "Ocultar"}
            </Button>
          </CardContent>
        </Card>
      )}

      {filteredDuplicates.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            {duplicates.length === 0 ? "No duplicates found! Great job." : "No duplicates to show (filtered)."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredDuplicates.map((group) => {
            const isExpanded = expandedGroups.has(group.normalized_name)
            const visibleCompanies = isExpanded ? group.companies : group.companies.slice(0, MAX_COMPANIES_SHOWN)
            const hasMore = group.companies.length > MAX_COMPANIES_SHOWN

            return (
              <Card key={group.normalized_name}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Badge variant="outline">{group.count} Matches</Badge>
                    Normalized: "{group.normalized_name}"
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {visibleCompanies.map((company) => {
                      const mergeTargets = group.companies
                        .filter((c) => c.id !== company.id)
                        .slice(0, MAX_MERGE_BUTTONS)

                      return (
                        <div key={company.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-md">
                          <div>
                            <div className="font-medium">{company.name}</div>
                            <div className="text-sm text-muted-foreground">
                              {company.linkedin_url || "No LinkedIn URL"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Created: {new Date(company.created_at).toLocaleDateString()}
                            </div>
                          </div>

                          <div className="flex gap-2 flex-wrap justify-end">
                            {mergeTargets.map((target) => (
                              <AlertDialog key={target.id}>
                                <AlertDialogTrigger asChild>
                                  <Button size="sm" variant="secondary" className="gap-1">
                                    Merge into <ArrowRight className="h-3 w-3" />
                                    <span className="max-w-[100px] truncate">{target.name}</span>
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Confirm Merge</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Are you sure you want to merge <strong>{company.name}</strong> into{" "}
                                      <strong>{target.name}</strong>?
                                      <br />
                                      <br />
                                      This will move all contacts, signals, and bookmarks to {target.name} and delete{" "}
                                      {company.name}. This action cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleMerge(target.id, company.id)}>
                                      Confirm Merge
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            ))}
                            {group.companies.length > MAX_MERGE_BUTTONS + 1 && (
                              <span className="text-xs text-muted-foreground self-center">
                                +{group.companies.length - MAX_MERGE_BUTTONS - 1} more
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}

                    {hasMore && (
                      <Button variant="ghost" className="w-full" onClick={() => toggleExpanded(group.normalized_name)}>
                        {isExpanded ? (
                          <>
                            <ChevronUp className="h-4 w-4 mr-2" />
                            Mostrar menos
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-4 w-4 mr-2" />
                            Mostrar {group.companies.length - MAX_COMPANIES_SHOWN} más
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
