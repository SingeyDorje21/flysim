/**
 * Autopilot panel state: what the pilot selected (engage buttons, mode,
 * targets) and what the autopilot annunciates. The panel and hotkeys write
 * the selections; the flight session reads them every physics step, refuses
 * or drops an engagement (with a message), and keeps the targets of a
 * disengaged hold following the aircraft so engaging holds what it is doing.
 * Values are SI.
 */

import { create } from 'zustand'
import type { AssistView } from '../autopilot/landingAssist'
import type { AutopilotTargets, TargetField, VerticalAnnunciation, VerticalMode } from '../autopilot/types'

export interface AutopilotState {
  ap: boolean
  athr: boolean
  vertical: VerticalMode
  targets: AutopilotTargets
  annunciation: VerticalAnnunciation
  /** Targets the pilot has set; the others follow the aircraft while their hold is off. */
  dialed: Record<TargetField, boolean>
  /** Last disconnect or refusal, e.g. "AP OFF: pilot input". Cleared on the next engagement. */
  message: string | null
  /** Landing assist (key 0) while it flies: the runway and the deviations; null when off. */
  assist: AssistView | null
  /** Bumped by each press of the landing-assist key; the session engages or cancels on a change. */
  assistRequests: number
  requestAssist(): void
  toggleAp(): void
  toggleAthr(): void
  setVertical(mode: VerticalMode): void
  setTarget(field: TargetField, value: number): void
}

export const INITIAL_TARGETS: Readonly<AutopilotTargets> = Object.freeze({
  speed: 0,
  headingDeg: 0,
  altitude: 0,
  verticalSpeed: 0,
})

const NONE_DIALED: Readonly<Record<TargetField, boolean>> = Object.freeze({
  speed: false,
  headingDeg: false,
  altitude: false,
  verticalSpeed: false,
})

const norm360 = (d: number) => ((d % 360) + 360) % 360

export const useAutopilotStore = create<AutopilotState>()((set) => ({
  ap: false,
  athr: false,
  vertical: 'ALT',
  targets: { ...INITIAL_TARGETS },
  annunciation: 'ALT',
  dialed: { ...NONE_DIALED },
  message: null,
  assist: null,
  assistRequests: 0,
  requestAssist: () => set((s) => ({ assistRequests: s.assistRequests + 1 })),
  toggleAp: () => set((s) => ({ ap: !s.ap, message: s.ap ? s.message : null })),
  toggleAthr: () => set((s) => ({ athr: !s.athr, message: s.athr ? s.message : null })),
  // A new V/S starts from the current vertical speed (the session keeps it following until then).
  setVertical: (mode) => set((s) => ({ vertical: mode, dialed: { ...s.dialed, verticalSpeed: false } })),
  setTarget: (field, value) => {
    if (!Number.isFinite(value)) return
    const v = field === 'headingDeg' ? norm360(value) : field === 'verticalSpeed' ? value : Math.max(0, value)
    set((s) => ({ targets: { ...s.targets, [field]: v }, dialed: { ...s.dialed, [field]: true } }))
  },
}))

/** Disengaging a hold lets its targets follow the aircraft again. */
export function clearDialed(fields: readonly TargetField[]): void {
  const s = useAutopilotStore.getState()
  if (!fields.some((f) => s.dialed[f])) return
  const dialed = { ...s.dialed }
  for (const f of fields) dialed[f] = false
  useAutopilotStore.setState({ dialed })
}

/** Everything off, targets cleared (new flight). */
export function resetAutopilot(): void {
  useAutopilotStore.setState({
    ap: false,
    athr: false,
    vertical: 'ALT',
    targets: { ...INITIAL_TARGETS },
    annunciation: 'ALT',
    dialed: { ...NONE_DIALED },
    message: null,
    assist: null,
  })
}
