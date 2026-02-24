"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { ChevronRight, Check } from "lucide-react"
import type { OnboardingStep } from "./steps"
import type { OnboardingState } from "@/app/actions/onboarding"
import { TRACK_LABELS, TRACK_ORDER, getTrackStepCount } from "./steps"

interface OnboardingOverlayProps {
  step: OnboardingStep
  state: OnboardingState
  onNext: () => void
  onSkip: () => void
}

interface TargetRect {
  top: number
  left: number
  width: number
  height: number
}

export function OnboardingOverlay({ step, state, onNext, onSkip }: OnboardingOverlayProps) {
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null)
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({})
  const [isVisible, setIsVisible] = useState(false)
  const [targetFound, setTargetFound] = useState(false)
  const hasScrolled = useRef(false)
  const retryCount = useRef(0)

  const findAndPosition = useCallback(() => {
    const el = document.querySelector(`[data-onboarding="${step.targetSelector}"]`)

    if (!el) {
      setTargetFound(false)
      // After retries, show tooltip centered without highlight
      if (retryCount.current >= 3) {
        setTargetRect(null)
        const tooltipWidth = 360
        setTooltipStyle({
          position: "fixed",
          width: tooltipWidth,
          zIndex: 10001,
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        })
        setIsVisible(true)
      }
      retryCount.current++
      return
    }

    setTargetFound(true)
    retryCount.current = 0

    // Scroll into view only once per step
    if (!hasScrolled.current) {
      el.scrollIntoView({ behavior: "smooth", block: "center" })
      hasScrolled.current = true
    }

    const rect = el.getBoundingClientRect()
    const padding = step.highlightPadding ?? 6

    // Use viewport-relative (fixed) coordinates
    const tRect: TargetRect = {
      top: rect.top - padding,
      left: rect.left - padding,
      width: rect.width + padding * 2,
      height: rect.height + padding * 2,
    }
    setTargetRect(tRect)

    // Calculate tooltip position (also viewport-relative)
    const tooltipWidth = 360
    const tooltipGap = 14
    const style: React.CSSProperties = {
      position: "fixed",
      width: tooltipWidth,
      zIndex: 10001,
    }

    switch (step.position) {
      case "bottom":
        style.top = tRect.top + tRect.height + tooltipGap
        style.left = Math.max(16, tRect.left + tRect.width / 2 - tooltipWidth / 2)
        break
      case "top":
        style.bottom = window.innerHeight - tRect.top + tooltipGap
        style.left = Math.max(16, tRect.left + tRect.width / 2 - tooltipWidth / 2)
        break
      case "left":
        style.top = tRect.top + tRect.height / 2 - 80
        style.left = Math.max(16, tRect.left - tooltipWidth - tooltipGap)
        break
      case "right":
        style.top = tRect.top + tRect.height / 2 - 80
        style.left = tRect.left + tRect.width + tooltipGap
        break
    }

    // Clamp left to viewport
    const maxLeft = window.innerWidth - tooltipWidth - 16
    if ((style.left as number) > maxLeft) style.left = maxLeft
    if ((style.left as number) < 16) style.left = 16

    // Clamp top to viewport
    if (style.top !== undefined && (style.top as number) < 8) style.top = 8

    setTooltipStyle(style)
    setIsVisible(true)
  }, [step])

  useEffect(() => {
    setIsVisible(false)
    setTargetFound(false)
    hasScrolled.current = false
    retryCount.current = 0

    // Try multiple times with increasing delays to find the element
    const timers = [
      setTimeout(findAndPosition, 400),
      setTimeout(findAndPosition, 900),
      setTimeout(findAndPosition, 1500),
      setTimeout(findAndPosition, 2500),
    ]

    const handleReposition = () => {
      requestAnimationFrame(findAndPosition)
    }

    window.addEventListener("resize", handleReposition)
    window.addEventListener("scroll", handleReposition, true)

    return () => {
      timers.forEach(clearTimeout)
      window.removeEventListener("resize", handleReposition)
      window.removeEventListener("scroll", handleReposition, true)
    }
  }, [findAndPosition])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault()
        onNext()
      }
      if (e.key === "Escape") {
        e.preventDefault()
        onSkip()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onNext, onSkip])

  // While still searching for element, show a subtle loading overlay
  if (!isVisible) {
    return (
      <div className="fixed inset-0 z-[9998] bg-black/40 transition-opacity duration-300" />
    )
  }

  const currentTrackSteps = getTrackStepCount(state.currentTrack!)
  const isLastStep = step.track === "prospeccion" && step.stepIndex === currentTrackSteps - 1
  const isLastOfTrack = step.stepIndex === currentTrackSteps - 1

  return (
    <>
      {/* Dark overlay - with cutout if target found, solid if not */}
      {targetFound && targetRect ? (
        <>
          <svg
            className="fixed inset-0 z-[9998] pointer-events-auto"
            width="100%"
            height="100%"
          >
            <defs>
              <mask id="onboarding-mask">
                <rect x="0" y="0" width="100%" height="100%" fill="white" />
                <rect
                  x={targetRect.left}
                  y={targetRect.top}
                  width={targetRect.width}
                  height={targetRect.height}
                  rx="8"
                  fill="black"
                />
              </mask>
            </defs>
            <rect
              x="0"
              y="0"
              width="100%"
              height="100%"
              fill="rgba(0,0,0,0.55)"
              mask="url(#onboarding-mask)"
            />
          </svg>

          {/* Highlight border around target */}
          <div
            className="fixed z-[9999] rounded-lg ring-2 ring-primary/60 ring-offset-2 ring-offset-transparent pointer-events-none transition-all duration-300"
            style={{
              top: targetRect.top,
              left: targetRect.left,
              width: targetRect.width,
              height: targetRect.height,
            }}
          />
        </>
      ) : (
        <div className="fixed inset-0 z-[9998] bg-black/55 pointer-events-auto" />
      )}

      {/* Tooltip */}
      <div
        className="z-[10001] pointer-events-auto"
        style={tooltipStyle}
      >
        <div className="bg-card border border-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Track breadcrumb */}
          <div className="px-4 pt-3 pb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            {TRACK_ORDER.map((t, i) => {
              const isCompleted = state.completedTracks.includes(t)
              const isCurrent = t === state.currentTrack
              return (
                <span key={t} className="flex items-center gap-1.5">
                  {i > 0 && <ChevronRight className="h-3 w-3 text-border" />}
                  <span className={
                    isCompleted
                      ? "text-primary font-medium"
                      : isCurrent
                        ? "text-foreground font-medium"
                        : "text-muted-foreground/50"
                  }>
                    {isCompleted && <Check className="h-3 w-3 inline mr-0.5" />}
                    {TRACK_LABELS[t]}
                  </span>
                </span>
              )
            })}
          </div>

          {/* Content */}
          <div className="px-4 pb-2">
            <h3 className="text-sm font-semibold text-foreground mb-1">
              {step.title}
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {step.content}
            </p>
          </div>

          {/* Footer */}
          <div className="px-4 py-3 flex items-center justify-between border-t border-border bg-muted/30">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {step.stepIndex + 1}/{currentTrackSteps}
              </span>
              {/* Step dots */}
              <div className="flex gap-1">
                {Array.from({ length: currentTrackSteps }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 rounded-full transition-all ${
                      i <= step.stepIndex
                        ? "w-3 bg-primary"
                        : "w-1.5 bg-border"
                    }`}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onSkip}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
              >
                Saltar tour
              </button>
              <button
                onClick={onNext}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                {isLastStep ? "Finalizar" : isLastOfTrack ? "Siguiente track" : "Siguiente"}
                {!isLastStep && <ChevronRight className="h-3 w-3" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
