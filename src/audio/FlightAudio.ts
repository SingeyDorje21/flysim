/**
 * Procedural flight sounds (no audio files): engine/propeller drone, wind,
 * tyre rumble, stall horn, plus one-shots for throttle detents, flaps,
 * touchdown, ring passes and crashes. Driven once per frame by update().
 */

import { getAudioContext } from './context'
import { SoundEventDetector, soundLevels, type AudioFrame, type SoundEvent } from './soundModel'

interface Graph {
  ctx: AudioContext
  master: GainNode
  noise: AudioBuffer
  engineOscs: OscillatorNode[]
  engineFilter: BiquadFilterNode
  engineGain: GainNode
  windFilter: BiquadFilterNode
  windGain: GainNode
  rollGain: GainNode
  hornGain: GainNode
  whineOsc: OscillatorNode
  whineGain: GainNode
  roarGain: GainNode
  afterburnerGain: GainNode
  sources: AudioScheduledSourceNode[]
}

const SMOOTH = 0.06

function makeNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  let seed = 12345
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    data[i] = (seed / 0x7fffffff) * 2 - 1
  }
  return buffer
}

function loopNoise(ctx: AudioContext, noise: AudioBuffer, sources: AudioScheduledSourceNode[], dest: AudioNode): void {
  const src = ctx.createBufferSource()
  src.buffer = noise
  src.loop = true
  src.connect(dest)
  src.start()
  sources.push(src)
}

function build(ctx: AudioContext): Graph {
  const master = ctx.createGain()
  master.gain.value = 0
  master.connect(ctx.destination)
  const sources: AudioScheduledSourceNode[] = []
  const noise = makeNoise(ctx)

  // Engine: sawtooth fundamental, detuned square octave, sine sub, low-passed.
  const engineFilter = ctx.createBiquadFilter()
  engineFilter.type = 'lowpass'
  const engineGain = ctx.createGain()
  engineGain.gain.value = 0
  engineFilter.connect(engineGain).connect(master)
  const engineOscs = (['sawtooth', 'square', 'sine'] as const).map((type, i) => {
    const osc = ctx.createOscillator()
    osc.type = type
    const mix = ctx.createGain()
    mix.gain.value = [0.6, 0.25, 0.5][i]
    osc.connect(mix).connect(engineFilter)
    osc.start()
    sources.push(osc)
    return osc
  })

  // Wind: band-passed noise that opens up with airspeed.
  const windFilter = ctx.createBiquadFilter()
  windFilter.type = 'bandpass'
  windFilter.Q.value = 0.7
  const windGain = ctx.createGain()
  windGain.gain.value = 0
  windFilter.connect(windGain).connect(master)
  loopNoise(ctx, noise, sources, windFilter)

  // Tyre rumble on the ground.
  const rollFilter = ctx.createBiquadFilter()
  rollFilter.type = 'lowpass'
  rollFilter.frequency.value = 180
  const rollGain = ctx.createGain()
  rollGain.gain.value = 0
  rollFilter.connect(rollGain).connect(master)
  loopNoise(ctx, noise, sources, rollFilter)

  // Stall horn: a steady reedy tone, gated.
  const horn = ctx.createOscillator()
  horn.type = 'square'
  horn.frequency.value = 420
  const hornGain = ctx.createGain()
  hornGain.gain.value = 0
  horn.connect(hornGain).connect(master)
  horn.start()
  sources.push(horn)

  // Jets: a band-passed turbine whine, a broadband exhaust roar and an afterburner rumble.
  const whineOsc = ctx.createOscillator()
  whineOsc.type = 'sawtooth'
  const whineFilter = ctx.createBiquadFilter()
  whineFilter.type = 'bandpass'
  whineFilter.Q.value = 4
  const whineGain = ctx.createGain()
  whineGain.gain.value = 0
  whineOsc.connect(whineFilter).connect(whineGain).connect(master)
  whineOsc.start()
  sources.push(whineOsc)
  const roarFilter = ctx.createBiquadFilter()
  roarFilter.type = 'lowpass'
  roarFilter.frequency.value = 700
  const roarGain = ctx.createGain()
  roarGain.gain.value = 0
  roarFilter.connect(roarGain).connect(master)
  loopNoise(ctx, noise, sources, roarFilter)
  const abFilter = ctx.createBiquadFilter()
  abFilter.type = 'lowpass'
  abFilter.frequency.value = 140
  const afterburnerGain = ctx.createGain()
  afterburnerGain.gain.value = 0
  abFilter.connect(afterburnerGain).connect(master)
  loopNoise(ctx, noise, sources, abFilter)

  return {
    ctx,
    noise,
    sources,
    master,
    engineOscs,
    engineFilter,
    engineGain,
    windFilter,
    windGain,
    rollGain,
    hornGain,
    whineOsc,
    whineGain,
    roarGain,
    afterburnerGain,
  }
}

/** Short decaying burst of filtered noise. */
function noiseBurst(g: Graph, type: BiquadFilterType, freq: number, gain: number, duration: number): void {
  const t = g.ctx.currentTime
  const src = g.ctx.createBufferSource()
  src.buffer = g.noise
  const filter = g.ctx.createBiquadFilter()
  filter.type = type
  filter.frequency.value = freq
  const env = g.ctx.createGain()
  env.gain.setValueAtTime(gain, t)
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  src.connect(filter).connect(env).connect(g.master)
  src.start(t, Math.random() * 1.5, duration)
}

/** Pitched tone with an exponential decay, optionally sliding in pitch. */
function tone(g: Graph, type: OscillatorType, from: number, to: number, gain: number, duration: number, delay = 0): void {
  const t = g.ctx.currentTime + delay
  const osc = g.ctx.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(from, t)
  osc.frequency.exponentialRampToValueAtTime(to, t + duration)
  const env = g.ctx.createGain()
  env.gain.setValueAtTime(0.0001, t)
  env.gain.exponentialRampToValueAtTime(gain, t + 0.01)
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  osc.connect(env).connect(g.master)
  osc.start(t)
  osc.stop(t + duration + 0.05)
}

function play(g: Graph, e: SoundEvent): void {
  switch (e.type) {
    case 'throttle':
      noiseBurst(g, 'bandpass', 2600, 0.15, 0.04)
      break
    case 'flaps':
      // Electric flap motor whine.
      tone(g, 'sawtooth', 160, 210, 0.06, 1.2)
      break
    case 'touchdown': {
      const firm = Math.min(1, e.sink / 3)
      tone(g, 'sine', 90, 40, 0.25 + 0.5 * firm, 0.3)
      if (e.groundSpeed > 15) noiseBurst(g, 'bandpass', 1800, 0.12 + 0.2 * firm, 0.35)
      break
    }
    case 'ring':
      tone(g, 'sine', 880, 880, 0.2, 0.25)
      tone(g, 'sine', 1320, 1320, 0.2, 0.4, 0.12)
      break
    case 'crash':
      noiseBurst(g, 'lowpass', 900, 0.9, 1.6)
      tone(g, 'sine', 70, 25, 0.8, 0.9)
      break
  }
}

export class FlightAudio {
  private graph: Graph | null = null
  private volume = 0.6
  private readonly detector = new SoundEventDetector()

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume))
  }

  update(frame: AudioFrame, dt: number): void {
    const events = this.detector.detect(frame, dt)
    const ctx = getAudioContext()
    if (!ctx || ctx.state !== 'running') return
    this.graph ??= build(ctx)
    const g = this.graph
    const t = ctx.currentTime
    const lv = soundLevels(frame)

    g.master.gain.setTargetAtTime(frame.frozen ? 0 : this.volume, t, 0.08)
    g.engineOscs[0].frequency.setTargetAtTime(lv.engineFreq, t, SMOOTH)
    g.engineOscs[1].frequency.setTargetAtTime(lv.engineFreq * 2.01, t, SMOOTH)
    g.engineOscs[2].frequency.setTargetAtTime(lv.engineFreq / 2, t, SMOOTH)
    g.engineFilter.frequency.setTargetAtTime(lv.engineCutoff, t, SMOOTH)
    g.engineGain.gain.setTargetAtTime(lv.engineGain, t, SMOOTH)
    g.windFilter.frequency.setTargetAtTime(lv.windFreq, t, SMOOTH)
    g.windGain.gain.setTargetAtTime(lv.windGain, t, 0.15)
    g.rollGain.gain.setTargetAtTime(lv.rollGain, t, SMOOTH)
    g.hornGain.gain.setTargetAtTime(lv.hornOn ? 0.06 : 0, t, 0.02)
    g.whineOsc.frequency.setTargetAtTime(lv.whineFreq, t, 0.15)
    g.whineGain.gain.setTargetAtTime(lv.whineGain, t, 0.15)
    g.roarGain.gain.setTargetAtTime(lv.roarGain, t, 0.2)
    // The afterburner lights with a thump and fades out slowly.
    g.afterburnerGain.gain.setTargetAtTime(lv.afterburnerGain, t, lv.afterburnerGain > 0 ? 0.08 : 0.4)

    if (!frame.frozen) for (const e of events) play(g, e)
  }

  dispose(): void {
    const g = this.graph
    this.graph = null
    if (!g) return
    for (const src of g.sources) {
      try {
        src.stop()
      } catch {
        // already stopped
      }
    }
    g.master.disconnect()
  }
}
