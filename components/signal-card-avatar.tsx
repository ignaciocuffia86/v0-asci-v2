"use client"

import { useState } from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { isValidImageUrl, getInitials } from "@/lib/utils/image-validator"

interface SignalCardAvatarProps {
  imageUrl: string | null | undefined
  fullName: string | null | undefined
  className?: string
}

export function SignalCardAvatar({ imageUrl, fullName, className = "h-14 w-14" }: SignalCardAvatarProps) {
  const [imageError, setImageError] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)

  // Validar URL
  const isValid = isValidImageUrl(imageUrl)
  const shouldShowImage = isValid && !imageError
  const initials = getInitials(fullName)

  return (
    <Avatar className={`${className} border-2 border-white shadow-sm ring-1 ring-slate-100 shrink-0`}>
      {shouldShowImage && (
        <AvatarImage
          src={imageUrl || "/placeholder.svg"}
          alt={fullName || "Contact"}
          className="object-cover"
          onError={() => {
            console.log("[v0] Image failed to load:", imageUrl)
            setImageError(true)
          }}
          onLoad={() => setImageLoaded(true)}
        />
      )}
      <AvatarFallback className="text-lg bg-primary/10 text-primary font-medium">{initials}</AvatarFallback>
    </Avatar>
  )
}
