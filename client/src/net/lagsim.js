/**
 * Штучна мережа на клієнті: затримка, розкид (jitter) і втрата пакетів
 * в обидва боки. Час — performance.now(), випадковість — Math.random()
 * (це не симуляція, тому детермінізм тут не потрібен).
 */
export function createLagSim({
  latencyMs = 0,
  jitterMs = 0,
  dropRate = 0,
  random = Math.random,
} = {}) {
  const cfg = { latencyMs, jitterMs, dropRate }
  let lastDue = 0
  return {
    cfg,
    /** Викликати fn через (latency ± jitter); порядок пакетів зберігаємо, як у TCP. */
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
