/**
 * One shared AudioContext. Browsers only allow audio after a user gesture, so
 * the context is created/resumed from the first click or key press.
 */

import { useEffect } from 'react'

let ctx: AudioContext | null = null

export function getAudioContext(): AudioContext | null {
  return ctx
}

export function unlockAudio(): void {
  try {
    if (!ctx) {
      if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return
      ctx = new window.AudioContext()
    }
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    // Audio unavailable: the game stays silent.
  }
}

export function useAudioUnlock(): void {
  useEffect(() => {
    window.addEventListener('pointerdown', unlockAudio)
    window.addEventListener('keydown', unlockAudio)
    return () => {
      window.removeEventListener('pointerdown', unlockAudio)
      window.removeEventListener('keydown', unlockAudio)
    }
  }, [])
}
