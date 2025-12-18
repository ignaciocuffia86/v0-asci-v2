export function isValidImageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false

  // Remover espacios en blanco
  url = url.trim()

  // Validar que sea una URL válida
  if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("data:")) {
    return false
  }

  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

// Extraer iniciales del nombre para avatar fallback
export function getInitials(fullName: string | null | undefined): string {
  if (!fullName) return "?"

  const names = fullName.trim().split(/\s+/)

  if (names.length >= 2) {
    // Tomar primera letra del primer nombre y primer nombre que no sea muy corto
    return (names[0]?.[0] || "") + (names[names.length - 1]?.[0] || "")
  }

  // Si es un solo nombre, tomar primeras 2 letras
  return fullName.substring(0, 2).toUpperCase()
}
