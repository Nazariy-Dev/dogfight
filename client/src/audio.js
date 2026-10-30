/**
 * Web Audio. AudioContext створюємо одразу, але браузер тримає його
 * в стані "suspended" до жесту користувача — unlock() викликаємо на клік.
 */
export function createAudio() {
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext
  const ctx = Ctx ? new Ctx() : null
  const buffers = {}
  let muted = false
  const stats = { played: 0 }

  function play(name, gain = 0.4) {
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
    setMuted: (m) => (muted = m),
    /** Підписка на шину: звук реагує на події, сим про звук не знає. */
    attach(bus) {
      bus.on('fired', () => play('shoot', 0.25))
      bus.on('hit', () => play('hit', 0.35))
      bus.on('exploded', () => play('explode', 0.5))
    },
  }
}
