"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { bookmarkCompanyBatch } from "@/app/actions/bookmarks"
import { useToast } from "@/hooks/use-toast"
import BulkBookmarkConfirmation from "./bulk-bookmark-confirmation"

interface BulkBookmarkButtonProps {
  selectedCompanyIds: string[]
  searchContext: any
  onSuccess?: () => void
}

export default function BulkBookmarkButton({ selectedCompanyIds, searchContext, onSuccess }: BulkBookmarkButtonProps) {
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const supabase = createClient()
  const { toast } = useToast()

  useEffect(() => {
    const getUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      setUserId(user?.id || null)
    }
    getUser()
  }, [])

  if (!selectedCompanyIds || selectedCompanyIds.length === 0) {
    return null
  }

  const handleConfirm = async () => {
    if (!userId) return

    setIsLoading(true)
    try {
      const result = await bookmarkCompanyBatch(userId, selectedCompanyIds, searchContext)

      if (result.success) {
        // `companiesCount` son las que realmente se crearon. Las que ya estaban
        // guardadas con este mismo contexto se saltean, asi que se avisan aparte
        // en vez de contarlas como nuevas.
        const creadas = result.companiesCount ?? 0
        const repetidas = result.alreadyExistedCount ?? 0

        toast({
          title: creadas > 0 ? "Éxito" : "Sin cambios",
          description:
            creadas === 0
              ? `Ya tenías ${repetidas === 1 ? "esta empresa" : `estas ${repetidas} empresas`} guardada${repetidas === 1 ? "" : "s"} con esta búsqueda`
              : repetidas > 0
                ? `Se crearon ${creadas} bookmarks (${repetidas} ya estaban guardadas)`
                : `Se crearon ${creadas} bookmarks`,
        })
        setShowConfirmation(false)
        onSuccess?.()
      } else {
        toast({
          title: "Error",
          description: result.error || "No se pudieron crear los bookmarks",
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Ocurrió un error inesperado",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <div className="fixed bottom-6 right-6 z-40">
        <Button onClick={() => setShowConfirmation(true)} size="lg" className="shadow-lg">
          + Crear {selectedCompanyIds.length} Bookmark{selectedCompanyIds.length !== 1 ? "s" : ""}
        </Button>
      </div>

      {showConfirmation && (
        <BulkBookmarkConfirmation
          count={selectedCompanyIds.length}
          isLoading={isLoading}
          onConfirm={handleConfirm}
          onCancel={() => setShowConfirmation(false)}
        />
      )}
    </>
  )
}
