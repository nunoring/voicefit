import type { VoiceProfile } from '@/types'

export type VoiceProfileListItem = Pick<VoiceProfile, 'id' | 'name' | 'created_at' | 'profile_json'>

export const SELECTED_VOICE_PROFILE_STORAGE_KEY = 'voicefit:selectedVoiceProfileId'

export function chooseVoiceProfileId(
  profiles: Array<{ id: string }>,
  preferredId?: string | null,
): string | null {
  if (preferredId && profiles.some((profile) => profile.id === preferredId)) {
    return preferredId
  }
  return profiles[0]?.id ?? null
}

export function readSelectedVoiceProfileId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(SELECTED_VOICE_PROFILE_STORAGE_KEY)
  } catch {
    return null
  }
}

export function writeSelectedVoiceProfileId(id: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (id) {
      window.localStorage.setItem(SELECTED_VOICE_PROFILE_STORAGE_KEY, id)
    } else {
      window.localStorage.removeItem(SELECTED_VOICE_PROFILE_STORAGE_KEY)
    }
  } catch {
    // Ignore private browsing/storage failures. Server state is still the source of truth.
  }
}
