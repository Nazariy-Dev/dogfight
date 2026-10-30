export interface Rng {
  next(): number
  range(a: number, b: number): number
  int(a: number, b: number): number
  readonly state: number
}

/** mulberry32: симуляція не викликає Math.random(), однаковий seed → однакова гра. */
export function createRng(seed = 1): Rng {
  let s = seed >>> 0
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    get state() {
      return s
    },
  }
}
