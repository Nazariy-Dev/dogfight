import type { GameBus } from './events.ts'

export type SoundName = 'shoot' | 'hit' | 'explode'

export interface GameAudio {
  readonly ctx: AudioContext | null
  readonly buffers: Partial<Record<string, AudioBuffer>>
  readonly stats: { played: number }
  unlock(): Promise<void> | undefined
  play(name: SoundName, gain?: number): void
  setMuted(m: boolean): void
  attach(bus: GameBus): void
}

/** Web Audio: контекст «suspended» до жесту, unlock() — на клік. */
export function createAudio(): GameAudio {
  const ctx = typeof AudioContext === 'function' ? new AudioContext() : null
  const buffers: Partial<Record<string, AudioBuffer>> = {}
  const stats = { played: 0 }
  let muted = false

  function play(name: SoundName, gain = 0.4): void {
    if (!ctx || muted || ctx.state !== 'running') return
    const buf = buffers[name]
    if (!buf) return
    const src = ctx.createBufferSource()
    const g = ctx.createGain()
    g.gain.value = gain
    src.buffer = buf
    src.connect(g).connect(ctx.destination)
    src.start()
    stats.played += 1
  }

  return {
    ctx,
    buffers,
    stats,
    unlock: () => ctx?.resume(),
    play,
    setMuted: (m) => void (muted = m),
    attach(bus) {
      bus.on('fired', () => play('shoot', 0.25))
      bus.on('hit', () => play('hit', 0.35))
      bus.on('exploded', () => play('explode', 0.5))
    },
  }
}
