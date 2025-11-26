"use client"

import { useEffect, useRef } from "react"
import Script from "next/script"

export function NetHuntForm() {
  const containerRef = useRef<HTMLDivElement>(null)
  const initialized = useRef(false)

  useEffect(() => {
    // Initialize nhform function when component mounts
    if (typeof window !== "undefined" && !initialized.current) {
      ;(window as any).nhform = () => {
        ;((window as any).nhform.data || ((window as any).nhform.data = [])).push(arguments)
      }
      initialized.current = true
    }
  }, [])

  const handleScriptLoad = () => {
    if (containerRef.current && typeof (window as any).nhform === "function") {
      ;(window as any).nhform("container", containerRef.current)
      ;(window as any).nhform("show", true)
    }
  }

  return (
    <div className="w-full max-w-md mx-auto">
      <div ref={containerRef} id="form-container" className="min-h-[300px] rounded-xl overflow-hidden" />
      <Script
        src="https://nethunt.com/service/automation/forms/69265b521fe70839b7c0d058?embed=script"
        strategy="lazyOnload"
        onLoad={handleScriptLoad}
      />
    </div>
  )
}
