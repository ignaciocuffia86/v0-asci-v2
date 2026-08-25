"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { deleteBookmark } from "@/app/actions/bookmarks"

export interface DeleteBookmarkTarget {
  id: string
  companyName: string | null
}

/**
 * Confirmacion unica para sacar una cuenta de los bookmarks. La usan las tres
 * entradas (kanban, lista y el detalle del bookmark) para que el usuario lea
 * siempre lo mismo sobre que se pierde y que se conserva.
 *
 * Controlado por el padre: abierto mientras `target` no sea null.
 */
export function DeleteBookmarkDialog({
  target,
  userId,
  onClose,
  onDeleted,
}: {
  target: DeleteBookmarkTarget | null
  userId: string
  onClose: () => void
  onDeleted: (bookmarkId: string) => void
}) {
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    if (!target) return

    setIsDeleting(true)
    const result = await deleteBookmark(userId, target.id)
    setIsDeleting(false)

    if (!result.success) {
      toast.error(result.error ?? "No se pudo eliminar el bookmark")
      return
    }

    toast.success(`${target.companyName ?? "La cuenta"} se saco de tus bookmarks`)
    onDeleted(target.id)
    onClose()
  }

  return (
    <AlertDialog open={!!target} onOpenChange={(open) => !open && !isDeleting && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            ¿Sacar {target?.companyName ?? "esta cuenta"} de tus bookmarks?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                Se eliminan el resumen, la estrategia, los icebreakers y las señales privadas que
                generaste para este bookmark.
              </p>
              <p>
                Se conservan las noticias, implementaciones, documentos públicos y contactos de la
                empresa: son datos compartidos y los siguen viendo el resto de los usuarios.
              </p>
              <p>Podés volver a guardar la empresa desde la búsqueda cuando quieras.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // El default del Action es cerrar el dialog; lo cerramos nosotros
              // recien cuando el server action confirmo que borro.
              e.preventDefault()
              void handleDelete()
            }}
            disabled={isDeleting}
          >
            {isDeleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Eliminar bookmark
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
