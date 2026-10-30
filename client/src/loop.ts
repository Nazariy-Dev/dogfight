export interface LoopStats {
  stepsPerSecond: number
  framesPerSecond: number
  frameTimeMs: number
  steps: number
}

export interface LoopOptions {
  step?: number
  maxFrame?: number
  simulate: (dt: number) => void
  render: (alpha: number, stats: Readonly<LoopStats>) => void
  fixed?: boolean
  schedule?: (cb: (now: number) => void) => number
  cancel?: (id: number) => void
  onFrame?: (now: number, stats: Readonly<LoopStats>) => void
}

export interface Loop {
  start(): void
  stop(): void
  readonly running: boolean
  readonly stats: Readonly<LoopStats>
}

/**
 * Ігровий цикл з фіксованим кроком (Fix Your Timestep): rAF + акумулятор,
 * дельта кадру обмежена maxFrame, render отримує alpha ∈ [0, 1).
 */
export function createLoop({
  step = 1 / 60,
  maxFrame = 0.25,
  simulate,
  render,
  fixed = true,
  schedule = (cb) => requestAnimationFrame(cb),
  cancel = (id) => cancelAnimationFrame(id),
  onFrame = () => {},
}: LoopOptions): Loop {
  let handle = 0
  let running = false
  let last = -1
  let accumulator = 0
  let windowStart = -1
  let stepsInWindow = 0
  let framesInWindow = 0
  const stats: LoopStats = {
    stepsPerSecond: 0,
    framesPerSecond: 0,
    frameTimeMs: 0,
    steps: 0,
  }

  function frame(now: number): void {
    if (!running) return
    const dt = last < 0 ? 0 : (now - last) / 1000
    last = now
    stats.frameTimeMs = dt * 1000
    if (windowStart < 0) windowStart = now

    if (fixed) {
      accumulator += Math.min(dt, maxFrame)
      while (accumulator >= step) {
        simulate(step)
        accumulator -= step
        stepsInWindow += 1
        stats.steps += 1
      }
      render(accumulator / step, stats)
    } else {
      if (dt > 0) {
        simulate(Math.min(dt, maxFrame))
        stepsInWindow += 1
        stats.steps += 1
      }
      render(1, stats)
    }
    framesInWindow += 1

    if (now - windowStart >= 1000) {
      const sec = (now - windowStart) / 1000
      stats.stepsPerSecond = Math.round(stepsInWindow / sec)
      stats.framesPerSecond = Math.round(framesInWindow / sec)
      stepsInWindow = 0
      framesInWindow = 0
      windowStart = now
    }
    onFrame(now, stats)
    handle = schedule(frame)
  }

  return {
    start() {
      if (running) return
      running = true
      last = -1
      accumulator = 0
      windowStart = -1
      handle = schedule(frame)
    },
    stop() {
      running = false
      cancel(handle)
    },
    get running() {
      return running
    },
    stats,
  }
}
