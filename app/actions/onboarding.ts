"use server"

import { createClient } from "@/lib/supabase/server"

export type OnboardingStatus = "pending" | "in_progress" | "skipped" | "completed"
export type OnboardingTrack = "segmentacion" | "documentacion" | "prospeccion"

export interface OnboardingState {
  status: OnboardingStatus
  currentTrack: OnboardingTrack | null
  currentStep: number
  completedTracks: string[]
  progressPercentage: number
}

const TOTAL_STEPS = 23 // 8 segmentacion + 5 documentacion + 10 prospeccion

export async function getOnboardingState(): Promise<OnboardingState | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from("user_onboarding")
    .select("*")
    .eq("user_id", user.id)
    .single()

  if (error || !data) {
    // Auto-create if missing (edge case)
    const { data: newData } = await supabase
      .from("user_onboarding")
      .insert({ user_id: user.id, status: "pending" })
      .select()
      .single()

    if (newData) {
      return {
        status: newData.status,
        currentTrack: newData.current_track,
        currentStep: newData.current_step,
        completedTracks: newData.completed_tracks || [],
        progressPercentage: newData.progress_percentage,
      }
    }
    return null
  }

  return {
    status: data.status,
    currentTrack: data.current_track,
    currentStep: data.current_step,
    completedTracks: data.completed_tracks || [],
    progressPercentage: data.progress_percentage,
  }
}

export async function startOnboarding(): Promise<OnboardingState | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from("user_onboarding")
    .update({
      status: "in_progress",
      current_track: "segmentacion",
      current_step: 0,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .select()
    .single()

  if (error || !data) return null

  return {
    status: data.status,
    currentTrack: data.current_track,
    currentStep: data.current_step,
    completedTracks: data.completed_tracks || [],
    progressPercentage: data.progress_percentage,
  }
}

function calculateProgress(track: OnboardingTrack, step: number, completedTracks: string[]): number {
  const trackSteps: Record<OnboardingTrack, number> = {
    segmentacion: 8,
    documentacion: 5,
    prospeccion: 10,
  }

  let completedStepsTotal = 0
  for (const ct of completedTracks) {
    completedStepsTotal += trackSteps[ct as OnboardingTrack] || 0
  }
  completedStepsTotal += step

  return Math.round((completedStepsTotal / TOTAL_STEPS) * 100)
}

export async function advanceOnboardingStep(
  track: OnboardingTrack,
  step: number
): Promise<OnboardingState | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Get current state
  const { data: current } = await supabase
    .from("user_onboarding")
    .select("*")
    .eq("user_id", user.id)
    .single()

  if (!current) return null

  const completedTracks = current.completed_tracks || []
  const progress = calculateProgress(track, step, completedTracks)

  const { data, error } = await supabase
    .from("user_onboarding")
    .update({
      status: "in_progress",
      current_track: track,
      current_step: step,
      progress_percentage: progress,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .select()
    .single()

  if (error || !data) return null

  return {
    status: data.status,
    currentTrack: data.current_track,
    currentStep: data.current_step,
    completedTracks: data.completed_tracks || [],
    progressPercentage: data.progress_percentage,
  }
}

export async function completeOnboardingTrack(
  track: OnboardingTrack
): Promise<OnboardingState | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: current } = await supabase
    .from("user_onboarding")
    .select("*")
    .eq("user_id", user.id)
    .single()

  if (!current) return null

  const completedTracks = [...(current.completed_tracks || [])]
  if (!completedTracks.includes(track)) {
    completedTracks.push(track)
  }

  const allTracks: OnboardingTrack[] = ["segmentacion", "documentacion", "prospeccion"]
  const allDone = allTracks.every((t) => completedTracks.includes(t))

  const trackOrder: OnboardingTrack[] = ["segmentacion", "documentacion", "prospeccion"]
  const currentIndex = trackOrder.indexOf(track)
  const nextTrack = allDone ? null : trackOrder[currentIndex + 1] || null

  const progress = allDone ? 100 : calculateProgress(nextTrack || track, 0, completedTracks)

  const { data, error } = await supabase
    .from("user_onboarding")
    .update({
      status: allDone ? "completed" : "in_progress",
      current_track: nextTrack,
      current_step: 0,
      completed_tracks: completedTracks,
      progress_percentage: progress,
      completed_at: allDone ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .select()
    .single()

  if (error || !data) return null

  return {
    status: data.status,
    currentTrack: data.current_track,
    currentStep: data.current_step,
    completedTracks: data.completed_tracks || [],
    progressPercentage: data.progress_percentage,
  }
}

export async function skipOnboarding(): Promise<OnboardingState | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Get current state to preserve progress
  const { data: current } = await supabase
    .from("user_onboarding")
    .select("*")
    .eq("user_id", user.id)
    .single()

  const { data, error } = await supabase
    .from("user_onboarding")
    .update({
      status: "skipped",
      skipped_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .select()
    .single()

  if (error || !data) return null

  return {
    status: data.status,
    currentTrack: data.current_track,
    currentStep: data.current_step,
    completedTracks: data.completed_tracks || [],
    progressPercentage: data.progress_percentage,
  }
}

export async function resumeOnboarding(): Promise<OnboardingState | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: current } = await supabase
    .from("user_onboarding")
    .select("*")
    .eq("user_id", user.id)
    .single()

  if (!current) return null

  const { data, error } = await supabase
    .from("user_onboarding")
    .update({
      status: "in_progress",
      current_track: current.current_track || "segmentacion",
      current_step: current.current_step || 0,
      skipped_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .select()
    .single()

  if (error || !data) return null

  return {
    status: data.status,
    currentTrack: data.current_track,
    currentStep: data.current_step,
    completedTracks: data.completed_tracks || [],
    progressPercentage: data.progress_percentage,
  }
}
