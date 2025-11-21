"use client"

import { useEffect, useState } from "react"
import {
  getPotentialDuplicates,
  mergeCompanies,
  autoMergeSafeDuplicates,
  type CompanyDuplicateGroup,
} from "@/app/actions/companies"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, ArrowRight } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
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

export default function DuplicatesPage() {
  const [duplicates, setDuplicates] = useState<CompanyDuplicateGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const { toast } = useToast()

  const fetchDuplicates = async () => {
    setLoading(true)
    try {
      const data = await getPotentialDuplicates()
      setDuplicates(data)
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load duplicates",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDuplicates()
  }, [])

  const handleAutoMerge = async () => {
    if (
      !confirm("Are you sure? This will automatically merge all groups where it's safe (single or no LinkedIn URL).")
    ) {
      return
    }

    setProcessing(true)
    try {
      const result = await autoMergeSafeDuplicates()
      if (result.success) {
        toast({
          title: "Auto-merge complete",
          description: `Successfully merged ${result.count} groups.`,
        })
        fetchDuplicates()
      } else {
        throw new Error(result.error)
      }
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
      fetchDuplicates() // Refresh list
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to merge companies",
        variant: "destructive",
      })
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
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
          <Button onClick={handleAutoMerge} disabled={loading || processing || duplicates.length === 0}>
            {processing ? "Processing..." : "Auto-Merge Safe Matches"}
          </Button>
        </div>
      </div>

      {duplicates.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">No duplicates found! Great job.</CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {duplicates.map((group) => (
            <Card key={group.normalized_name}>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Badge variant="outline">{group.count} Matches</Badge>
                  Normalized: "{group.normalized_name}"
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {group.companies.map((company) => (
                    <div key={company.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-md">
                      <div>
                        <div className="font-medium">{company.name}</div>
                        <div className="text-sm text-muted-foreground">{company.linkedin_url || "No LinkedIn URL"}</div>
                        <div className="text-xs text-muted-foreground">
                          Created: {new Date(company.created_at).toLocaleDateString()}
                        </div>
                      </div>

                      <div className="flex gap-2">
                        {group.companies
                          .filter((c) => c.id !== company.id)
                          .map((target) => (
                            <AlertDialog key={target.id}>
                              <AlertDialogTrigger asChild>
                                <Button size="sm" variant="secondary" className="gap-1">
                                  Merge into <ArrowRight className="h-3 w-3" /> {target.name}
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
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
