import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createTokenBucket } from '../src/ratelimit.ts'
import { createTicker, percentile } from '../src/timer.ts'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('token bucket: ємність, поповнення, n > 1', () => {
  let t = 0
  const b = createTokenBucket({ rate: 10, capacity: 5, now: () => t })
  for (let i = 0; i < 5; i++) expect(b.take()).toBe(true)
  expect(b.take()).toBe(false)
  t = 250 // +2,5 токена
  expect(b.take(2)).toBe(true)
  expect(b.take(1)).toBe(false)
  t = 10_000
  expect(b.tokens).toBeLessThanOrEqual(5)
})

test('ticker на фейковому годиннику: 30 кроків за 1 с, без дрейфу', () => {
  let n = 0
  const t = createTicker(1000 / 30, () => void n++, { now: () => performance.now() })
  t.start()
  vi.advanceTimersByTime(1000)
  t.stop()
  expect(n).toBeGreaterThanOrEqual(29)
  expect(n).toBeLessThanOrEqual(31)
})

test('ticker: крок, що «завис» на 1 с, не викликає лавину з 30 кроків', () => {
  let clock = 0
  const calls: number[] = []
  const t = createTicker(100, (k) => void calls.push(k), {
    now: () => clock,
    maxBehind: 3,
  })
  t.start()
  // перший крок виконався одразу; поки чекаємо другого, процес «спить» секунду
  clock = 1000
  vi.advanceTimersByTime(100)
  t.stop()
  expect(t.stats.skipped).toBeGreaterThan(0)
  expect(calls.length).toBeLessThan(5)
})

test('percentile', () => {
  expect(percentile([], 0.99)).toBe(0)
  expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3)
  expect(percentile([1, 2, 3, 4, 100], 0.99)).toBe(100)
})
