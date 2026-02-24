"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import { usePathname, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import {
  getOnboardingState,
  startOnboarding,
  advanceOnboardingStep,
  completeOnboardingTrack,
  skipOnboarding,
  resumeOnboarding,
  type OnboardingState,
  type OnboardingTrack,
} from "@/app/actions/onboarding"
import {
  getStepByTrackAndIndex,
  getTrackStepCount,
  TRACK_ORDER,
  type OnboardingStep,
} from "./steps"
import { OnboardingOverlay } from "./onboarding-overlay"

interface OnboardingContextType {
  isActive: boolean
  currentStep: OnboardingStep | null
  state: OnboardingState | null
  start: () => Promise<void>
  next: () => Promise<void>
  skip: () => Promise<void>
  resume: () => Promise<void>
  isLoading: boolean
}

const OnboardingContext = createContext<OnboardingContextType>({
  isActive: false,
  currentStep: null,
  state: null,
  start: async () => {},
  next: async () => {},
  skip: async () => {},
  resume: async () => {},
  isLoading: true,
})

export function useOnboarding() {
  return useContext(OnboardingContext)
}

// Helper: does the current pathname match the step route?
function routeMatches(pathname: string, stepRoute: string): boolean {
  if (stepRoute === "/bookmarks/[id]") {
    // Match any /bookmarks/<uuid> path
    return /^\/bookmarks\/[^/]+$/.test(pathname) && pathname !== "/bookmarks"
  }
  return pathname === stepRoute
}

// Helper: navigate to the correct route for a step
async function navigateToStepRoute(
  stepRoute: string,
  pathname: string,
  router: ReturnType<typeof useRouter>
): Promise<void> {
  if (routeMatches(pathname, stepRoute)) return

  if (stepRoute === "/bookmarks/[id]") {
    // Find the first bookmark to navigate to
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: bookmarks } = await supabase
      .from("bookmarks")
      .select("id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)

    if (bookmarks && bookmarks.length > 0) {
      router.push(`/bookmarks/${bookmarks[0].id}`)
    } else {
      // No bookmarks exist - skip these workspace steps
      router.push("/bookmarks")
    }
  } else {
    router.push(stepRoute)
  }
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OnboardingState | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [showWelcome, setShowWelcome] = useState(false)
  const [showCompletion, setShowCompletion] = useState(false)
  const router = useRouter()
  const pathname = usePathname()

  // Load onboarding state on mount
  useEffect(() => {
    const load = async () => {
      try {
        const s = await getOnboardingState()
        setState(s)
        if (s && s.status === "pending") {
          setShowWelcome(true)
        }
      } catch {
        // Not authenticated or error - expected on public pages
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

  const isActive = state?.status === "in_progress" && state.currentTrack !== null

  const currentStep = isActive && state?.currentTrack
    ? getStepByTrackAndIndex(state.currentTrack, state.currentStep) || null
    : null

  // Navigate to the correct page for the current step
  useEffect(() => {
    if (currentStep) {
      navigateToStepRoute(currentStep.route, pathname, router)
    }
  }, [currentStep?.id])

  const start = useCallback(async () => {
    setShowWelcome(false)
    const s = await startOnboarding()
    setState(s)
    if (s?.currentTrack) {
      const step = getStepByTrackAndIndex(s.currentTrack, 0)
      if (step) {
        await navigateToStepRoute(step.route, pathname, router)
      }
    }
  }, [pathname, router])

  const next = useCallback(async () => {
    if (!state?.currentTrack) return

    const trackStepCount = getTrackStepCount(state.currentTrack)
    const nextStepIndex = state.currentStep + 1

    if (nextStepIndex >= trackStepCount) {
      // Complete this track, move to next
      const s = await completeOnboardingTrack(state.currentTrack)
      setState(s)

      if (s?.status === "completed") {
        setShowCompletion(true)
        return
      }

      // Navigate to next track's page
      if (s?.currentTrack) {
        const firstStep = getStepByTrackAndIndex(s.currentTrack, 0)
        if (firstStep) {
          await navigateToStepRoute(firstStep.route, pathname, router)
        }
      }
    } else {
      // Advance within current track
      const s = await advanceOnboardingStep(state.currentTrack, nextStepIndex)
      setState(s)

      // Check if we need to navigate
      const nextStep = getStepByTrackAndIndex(state.currentTrack, nextStepIndex)
      if (nextStep) {
        await navigateToStepRoute(nextStep.route, pathname, router)
      }
    }
  }, [state, pathname, router])

  const skip = useCallback(async () => {
    setShowWelcome(false)
    const s = await skipOnboarding()
    setState(s)
  }, [])

  const resume = useCallback(async () => {
    const s = await resumeOnboarding()
    setState(s)
    if (s?.currentTrack) {
      const step = getStepByTrackAndIndex(s.currentTrack, s.currentStep)
      if (step) {
        await navigateToStepRoute(step.route, pathname, router)
      }
    }
  }, [pathname, router])

  // Check if current step route matches
  const stepRouteMatch = currentStep ? routeMatches(pathname, currentStep.route) : false

  return (
    <OnboardingContext.Provider
      value={{ isActive, currentStep, state, start, next, skip, resume, isLoading }}
    >
      {children}

      {/* Welcome modal for pending onboarding */}
      {showWelcome && <WelcomeModal onStart={start} onSkip={skip} />}

      {/* Completion celebration */}
      {showCompletion && <CompletionModal onClose={() => setShowCompletion(false)} />}

      {/* Active tour overlay */}
      {isActive && currentStep && stepRouteMatch && (
        <OnboardingOverlay step={currentStep} state={state!} onNext={next} onSkip={skip} />
      )}
    </OnboardingContext.Provider>
  )
}

function WelcomeModal({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-2xl max-w-md w-full mx-4 p-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-foreground">Bienvenido a ASCI</h2>
        </div>

        <p className="text-muted-foreground text-sm leading-relaxed mb-6">
          Te vamos a guiar en un recorrido rapido por la plataforma para que puedas aprovecharla al maximo.
          El tour cubre 3 areas clave:
        </p>

        <div className="space-y-3 mb-8">
          <div className="flex items-start gap-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary shrink-0 mt-0.5">1</span>
            <div>
              <p className="text-sm font-medium text-foreground">Segmentacion</p>
              <p className="text-xs text-muted-foreground">Busqueda de senales y discovery de cuentas</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary shrink-0 mt-0.5">2</span>
            <div>
              <p className="text-sm font-medium text-foreground">Documentacion</p>
              <p className="text-xs text-muted-foreground">Carga de casos de exito y propuestas de valor</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary shrink-0 mt-0.5">3</span>
            <div>
              <p className="text-sm font-medium text-foreground">Prospeccion</p>
              <p className="text-xs text-muted-foreground">Workspace, estrategia y contacto con cuentas</p>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onSkip}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground border border-border rounded-lg transition-colors hover:bg-accent"
          >
            Ahora no
          </button>
          <button
            onClick={onStart}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-primary-foreground bg-primary rounded-lg transition-colors hover:bg-primary/90"
          >
            Comenzar tour
          </button>
        </div>
      </div>
    </div>
  )
}

function CompletionModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-2xl max-w-sm w-full mx-4 p-8 text-center">
        <div className="h-14 w-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
          <svg className="h-7 w-7 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">Tour completado</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Ya conoces todas las herramientas de ASCI. Ahora es momento de empezar a prospectar.
        </p>
        <button
          onClick={onClose}
          className="w-full px-4 py-2.5 text-sm font-medium text-primary-foreground bg-primary rounded-lg transition-colors hover:bg-primary/90"
        >
          Empezar a usar ASCI
        </button>
      </div>
    </div>
  )
}
