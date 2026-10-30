/**
 * Точний тікер без setInterval: кожен крок плануємо на абсолютний цільовий час
 * start + n·period. Похибка одного кроку не накопичується. setTimeout будить
 * трохи раніше, решту добираємо через setImmediate.
 * Якщо крок запізнився більше ніж на maxBehind кроків — пропускаємо їх (не наздоганяємо лавиною).
 */
export function createTicker(
  period,
  onTick,
  { now = () => performance.now(), maxBehind = 5 } = {},
) {
  let start = 0
  let n = 0
  let timer = null
  let running = false
  const stats = { ticks: 0, skipped: 0, lateMs: [], durMs: [] }

  function schedule() {
    if (!running) return
    const target = start + n * period
    const wait = target - now()
    if (wait > 2) timer = setTimeout(schedule, wait - 1.5)
    else if (wait > 0) timer = setImmediate(schedule)
    else run(target)
  }
  function run(target) {
    const late = now() - target
    if (late > period * maxBehind) {
      const skip = Math.floor(late / period)
      n += skip
      stats.skipped += skip
    }
    const t0 = now()
    onTick(n)
    const dur = now() - t0
    stats.ticks += 1
    push(stats.lateMs, late)
    push(stats.durMs, dur)
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
      clearTimeout(timer)
      clearImmediate(timer)
    },
    stats,
  }
}

function push(arr, v) {
  arr.push(v)
  if (arr.length > 300) arr.shift()
}

export function percentile(arr, p) {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
