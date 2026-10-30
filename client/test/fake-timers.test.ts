import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createLoop } from '../src/loop.ts'
import { createLagSim } from '../src/net/lagsim.ts'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('цикл на фейкових таймерах: 10 с при кадрах по 16 мс → 600 кроків симуляції', () => {
  let steps = 0
  // планувальник на setTimeout(16): фейкові таймери повністю контролюють час
  const loop = createLoop({
    simulate: () => void steps++,
    render() {},
    schedule: (cb) => Number(setTimeout(() => cb(performance.now()), 16)),
    cancel: (id) => clearTimeout(id),
  })
  loop.start()
  vi.advanceTimersByTime(10_000)
  loop.stop()
  expect(Math.abs(steps - 600)).toBeLessThanOrEqual(2)
})

test('lagsim: затримка 100 мс, порядок зберігається, drop=1 — нічого не доходить', () => {
  const got: number[] = []
  const lag = createLagSim({ latencyMs: 100, jitterMs: 50 }, () => 0.99)
  const lag2 = createLagSim({ latencyMs: 100, jitterMs: 50 }, () => 0)
  lag.deliver(() => void got.push(1)) // 149 мс
  lag2.deliver(() => void got.push(2)) // 50 мс — але в іншому каналі
  vi.advanceTimersByTime(60)
  expect(got).toEqual([2])
  vi.advanceTimersByTime(100)
  expect(got).toEqual([2, 1])
  const dropped = createLagSim({ dropRate: 1 })
  expect(dropped.deliver(() => void got.push(3))).toBe(false)
})
