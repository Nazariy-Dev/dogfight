export interface LagConfig {
  latencyMs: number
  jitterMs: number
  dropRate: number
}

/** Штучна мережа: затримка, розкид і втрата; порядок пакетів зберігається, як у TCP. */
export function createLagSim(
  { latencyMs = 0, jitterMs = 0, dropRate = 0 }: Partial<LagConfig> = {},
  random: () => number = Math.random,
): { cfg: LagConfig; deliver(fn: () => void): boolean } {
  const cfg: LagConfig = { latencyMs, jitterMs, dropRate }
  let lastDue = 0
  return {
    cfg,
    deliver(fn) {
      if (cfg.dropRate > 0 && random() < cfg.dropRate) return false
      const delay = cfg.latencyMs + (random() * 2 - 1) * cfg.jitterMs
      const due = Math.max(performance.now() + Math.max(0, delay), lastDue)
      lastDue = due
      const wait = due - performance.now()
      if (wait <= 0) fn()
      else setTimeout(fn, wait)
      return true
    },
  }
}
