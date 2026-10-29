import { afterEach, describe, expect, it, vi } from 'vitest'
import { stopSpeech } from '../callouts'

function fakeSynth(state: { speaking: boolean; pending: boolean }) {
  const synth = { ...state, cancel: vi.fn() }
  vi.stubGlobal('speechSynthesis', synth)
  return synth
}

describe('stopSpeech', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('cancels a callout still being read out', () => {
    const synth = fakeSynth({ speaking: true, pending: false })
    stopSpeech()
    expect(synth.cancel).toHaveBeenCalledOnce()
  })

  it('cancels queued callouts', () => {
    const synth = fakeSynth({ speaking: false, pending: true })
    stopSpeech()
    expect(synth.cancel).toHaveBeenCalledOnce()
  })

  it('leaves an idle voice alone', () => {
    const synth = fakeSynth({ speaking: false, pending: false })
    stopSpeech()
    expect(synth.cancel).not.toHaveBeenCalled()
  })

  it('does nothing where speech is unsupported', () => {
    vi.stubGlobal('speechSynthesis', undefined)
    expect(() => stopSpeech()).not.toThrow()
  })
})
