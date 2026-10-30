// Перевірки Lab 1 без браузера: node --test test/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLoop } from '../src/loop.ts'
import { createShip, integrate, MAX_SPEED } from '@dogfight/shared/sim/ship.ts'
import { wrap, unwrapPrevious } from '@dogfight/shared/sim/arena.ts'
import { lerpAngle } from '../src/render/lerp.ts'
import { createInput } from '../src/input.ts'

// Ручний планувальник: кадр викликається лише тоді, коли тест скаже
function fakeScheduler(): {
  schedule: (f: (now: number) => void) => number
  cancel: () => void
  tick: (now: number) => void
} {
  let cb: ((now: number) => void) | null = null
  return {
    schedule: (f) => ((cb = f), 1),
    cancel: () => void (cb = null),
    tick: (now) => cb?.(now),
  }
}

function runLoop(hz: number, seconds: number) {
  const fs = fakeScheduler()
  let steps = 0
  const alphas: number[] = []
  const loop = createLoop({
    simulate: () => void steps++,
    render: (a) => void alphas.push(a),
    schedule: fs.schedule,
    cancel: fs.cancel,
  })
  loop.start()
  const frames = Math.round(hz * seconds)
  for (let i = 0; i <= frames; i++) fs.tick((i * 1000) / hz)
  return { steps, alphas, loop }
}

test('60 кроків/с незалежно від частоти кадрів (30, 60, 144 Гц)', () => {
  for (const hz of [30, 60, 144]) {
    const { steps } = runLoop(hz, 10)
    assert.ok(Math.abs(steps - 600) <= 1, `hz=${hz} steps=${steps}`)
  }
})

test('alpha завжди в [0, 1)', () => {
  const { alphas } = runLoop(144, 2)
  assert.ok(alphas.every((a) => a >= 0 && a < 1))
})

test('довгий кадр обрізається до 0,25 с (15 кроків, без спіралі)', () => {
  const fs = fakeScheduler()
  let steps = 0
  createLoop({ simulate: () => void steps++, render() {}, ...fs }).start()
  fs.tick(0)
  fs.tick(5000) // 5 с паузи
  assert.equal(steps, 15)
})

test('stop() припиняє кадри', () => {
  const fs = fakeScheduler()
  let steps = 0
  const loop = createLoop({ simulate: () => void steps++, render() {}, ...fs })
  loop.start()
  fs.tick(0)
  loop.stop()
  fs.tick(1000)
  assert.equal(steps, 0)
  assert.equal(loop.running, false)
})

test('integrate детермінований і не перевищує MAX_SPEED', () => {
  const a = createShip()
  const b = createShip()
  for (let i = 0; i < 600; i++) {
    const c = { thrust: true, left: i % 7 === 0, right: false, fire: false }
    integrate(a, c, 1 / 60)
    integrate(b, c, 1 / 60)
  }
  assert.deepEqual(a, b)
  assert.ok(Math.hypot(a.vx, a.vy) <= MAX_SPEED + 1e-9)
})

test('без газу корабель гальмує до нуля', () => {
  const s = createShip()
  s.vx = 200
  for (let i = 0; i < 60 * 20; i++) integrate(s, {}, 1 / 60)
  assert.ok(Math.abs(s.vx) < 1e-3)
})

test("wrap: від'ємні та завеликі координати", () => {
  assert.deepEqual(wrap({ x: -5, y: 805 }, 800, 600), { x: 795, y: 205 })
  assert.deepEqual(wrap({ x: 800, y: 0 }, 800, 600), { x: 0, y: 0 })
})

test('unwrapPrevious: prev зсувається на ширину арени', () => {
  const prev = { x: 798, y: 10 }
  unwrapPrevious(prev, { x: 2, y: 10 }, 800, 600)
  assert.equal(prev.x, -2)
})

test('lerpAngle йде коротшим шляхом через ±π', () => {
  const m = lerpAngle(3.1, -3.1, 0.5)
  assert.ok(Math.abs(Math.abs(m) - Math.PI) < 0.01, `m=${m}`)
  assert.equal(lerpAngle(0, 1, 0.25), 0.25)
})

test('createInput: isDown, justPressed, consume, blur', () => {
  const t = new EventTarget()
  const key = (type: string, code: string, repeat = false): void => {
    t.dispatchEvent(Object.assign(new Event(type), { code, repeat }))
  }
  const inp = createInput(t)
  key('keydown', 'Space')
  assert.ok(inp.isDown('Space') && inp.justPressed('Space'))
  inp.consume()
  key('keydown', 'Space', true) // автоповтор — не новий фронт
  assert.ok(!inp.justPressed('Space'))
  t.dispatchEvent(new Event('blur'))
  assert.ok(!inp.isDown('Space'))
})
