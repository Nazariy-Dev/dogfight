/**
 * Перевірка Origin на рукостисканні WebSocket. CORS на WebSocket не діє, тож без цього
 * будь-яка сторінка могла б підключатись до сервера від імені своїх відвідувачів.
 * Порожній список = дозволити все (розробка). Клієнти без Origin (боти, тест навантаження) —
 * лише якщо allowNoOrigin.
 */
export function originAllowed(
  origin: string | undefined,
  allowed: readonly string[],
  allowNoOrigin: boolean,
): boolean {
  if (allowed.length === 0) return true
  if (!origin) return allowNoOrigin
  return allowed.includes(origin)
}

/** Лічильник з'єднань на IP. */
export class IpLimiter {
  readonly #count = new Map<string, number>()
  readonly max: number
  constructor(max: number) {
    this.max = max
  }
  acquire(ip: string): boolean {
    const n = this.#count.get(ip) ?? 0
    if (n >= this.max) return false
    this.#count.set(ip, n + 1)
    return true
  }
  release(ip: string): void {
    const n = (this.#count.get(ip) ?? 1) - 1
    if (n <= 0) this.#count.delete(ip)
    else this.#count.set(ip, n)
  }
  get size(): number {
    return this.#count.size
  }
}
