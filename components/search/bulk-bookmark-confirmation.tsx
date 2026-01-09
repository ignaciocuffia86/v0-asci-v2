"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface BulkBookmarkConfirmationProps {
  count: number
  isLoading: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function BulkBookmarkConfirmation({
  count,
  isLoading,
  onConfirm,
  onCancel,
}: BulkBookmarkConfirmationProps) {
  return (
    <AlertDialog open={true}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Crear Bookmarks</AlertDialogTitle>
          <AlertDialogDescription>
            Estás a punto de crear {count} bookmark{count !== 1 ? "s" : ""} con el contexto de búsqueda actual. Esta
            acción no se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex gap-3 justify-end">
          <AlertDialogCancel onClick={onCancel} disabled={isLoading}>
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={isLoading}>
            {isLoading ? "Creando..." : "Confirmar"}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
