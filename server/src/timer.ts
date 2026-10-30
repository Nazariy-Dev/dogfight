export interface TickerStats {
  ticks: number
  skipped: number
  lateMs: number[]
  durMs: number[]
}
export interface Ticker {
  start(): void
  stop(): void
  readonly stats: TickerStats
}

/**
 * Точний тікер без setInterval: кожен крок плануємо на абсолютний час start + n·period.
 * Якщо крок запізнився більше ніж на maxBehind кроків — пропускаємо їх.
 */
export function createTicker(
  period: number,
  onTick: (n: number) => void,
  {
    now = () => performance.now(),
    maxBehind = 5,
  }: { now?: () => number; maxBehind?: number } = {},
): Ticker {
  let start = 0
  let n = 0
  let timeout: NodeJS.Timeout | undefined
  let immediate: NodeJS.Immediate | undefined
  let running = false
  const stats: TickerStats = { ticks: 0, skipped: 0, lateMs: [], durMs: [] }

  function schedule(): void {
    if (!running) return
    const target = start + n * period
    const wait = target - now()
    if (wait > 2) timeout = setTimeout(schedule, wait - 1.5)
    else if (wait > 0) immediate = setImmediate(schedule)
    else run(target)
  }
  function run(target: number): void {
    const late = now() - target
    if (late > period * maxBehind) {
      const skip = Math.floor(late / period)
      n += skip
      stats.skipped += skip
    }
    const t0 = now()
    onTick(n)
    stats.ticks += 1
    push(stats.lateMs, late)
    push(stats.durMs, now() - t0)
    n += 1
    schedule()
  }
  return {
    start() {
      if (running) return
      running = true
      start = now()
      n = 0
      schedule()
    },
    stop() {
      running = false
      clearTimeout(timeout)
      clearImmediate(immediate)
    },
    stats,
  }
}

function push(arr: number[], v: number): void {
  arr.push(v)
  if (arr.length > 300) arr.shift()
}

export function percentile(arr: readonly number[], p: number): number {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0
}
