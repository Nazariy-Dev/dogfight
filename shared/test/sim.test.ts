import { describe, expect, test } from 'vitest'
import { Vector2 } from '../src/sim/vector.ts'
import { Asteroid, Bullet, Pickup, Ship, particlePool } from '../src/sim/entity.ts'
import { World } from '../src/sim/world.ts'
import { naivePairs, circlesOverlap } from '../src/sim/collision.ts'
import { spatialHashPairs } from '../src/sim/spatial.ts'
import { Pool } from '../src/sim/pool.ts'
import { integrate, ROTATE_SPEED, THRUST } from '../src/sim/ship.ts'
import { createRng } from '../src/sim/rng.ts'
import { wrap, unwrapPrevious, mod } from '../src/sim/arena.ts'

describe('Vector2', () => {
  test('add/sub/scale/dot/length', () => {
    const a = new Vector2(3, 4)
    expect(a.add(new Vector2(1, 1))).toEqual(new Vector2(4, 5))
    expect(a.sub(new Vector2(1, 1))).toEqual(new Vector2(2, 3))
    expect(a.scale(2)).toEqual(new Vector2(6, 8))
    expect(a.dot(new Vector2(1, 0))).toBe(3)
    expect(a.length()).toBe(5)
  })
  test('normalize: одиничний; нульовий вектор лишається нульовим', () => {
    expect(new Vector2(0, 10).normalize()).toEqual(new Vector2(0, 1))
    expect(new Vector2(0, 0).normalize()).toEqual(new Vector2(0, 0))
  })
  test('fromAngle і rotate', () => {
    const v = Vector2.fromAngle(Math.PI / 2, 2)
    expect(v.x).toBeCloseTo(0)
    expect(v.y).toBeCloseTo(2)
    expect(new Vector2(1, 0).rotate(Math.PI).x).toBeCloseTo(-1)
  })
})

describe('integrate', () => {
  test('поворот ліворуч за 1 с = ROTATE_SPEED', () => {
    const s = { x: 0, y: 0, vx: 0, vy: 0, angle: 0 }
    for (let i = 0; i < 60; i++) integrate(s, { left: true }, 1 / 60)
    expect(s.angle).toBeCloseTo(-ROTATE_SPEED, 6)
  })
  test('один крок газу вздовж осі X', () => {
    const s = { x: 0, y: 0, vx: 0, vy: 0, angle: 0 }
    integrate(s, { thrust: true }, 0.1)
    expect(s.vx).toBeCloseTo(THRUST * 0.1 * Math.exp(-0.9 * 0.1), 6)
    expect(s.vy).toBe(0)
  })
  test('dt = 0 нічого не змінює', () => {
    const s = { x: 5, y: 6, vx: 7, vy: 8, angle: 1 }
    integrate(s, { thrust: true, left: true }, 0)
    expect(s).toMatchObject({ x: 5, y: 6, vx: 7, vy: 8, angle: 1 })
  })
})

describe('арена', () => {
  test("mod для від'ємних", () => expect(mod(-1, 10)).toBe(9))
  test('wrap і unwrapPrevious', () => {
    expect(wrap({ x: 1281, y: -1 }, 1280, 720)).toEqual({ x: 1, y: 719 })
    const prev = { x: 5, y: 715 }
    unwrapPrevious(prev, { x: 1275, y: 3 }, 1280, 720)
    expect(prev).toEqual({ x: 1285, y: -5 })
  })
})

describe('колізії', () => {
  const mk = (x: number, y: number) => new Asteroid({ x, y, size: 1 })
  test('дотик / перетин / далеко', () => {
    const a = mk(0, 0)
    expect(circlesOverlap(a, mk(38, 0))).toBe(false) // радіус size 1 = 19, дотик на 38
    expect(circlesOverlap(a, mk(37.9, 0))).toBe(true)
    expect(circlesOverlap(a, mk(500, 500))).toBe(false)
  })
  test('швидка куля «тунелює» крізь корабель за один крок (відоме обмеження)', () => {
    const w = new World()
    const ship = w.spawn(new Ship({ x: 300, y: 300 }))
    ship.shield = 0
    // куля стартує за 40 px ліворуч і за крок 1/30 с проходить 2000/30 ≈ 67 px — перескакує коло радіусом 14+3
    w.spawn(new Bullet({ x: 260, y: 300, vx: 2000, vy: 0, owner: -1 }))
    w.step(1 / 30)
    expect(ship.hp).toBe(100)
  })
  test('просторовий хеш дає ті самі пари, що й O(n²)', () => {
    const rng = createRng(9)
    for (let round = 0; round < 20; round++) {
      const ents = Array.from(
        { length: 80 },
        () => new Pickup({ x: rng.range(0, 1280), y: rng.range(0, 720) }),
      )
      const key = (ps: ReturnType<typeof naivePairs>) =>
        ps.map(([a, b]) => [Math.min(a.id, b.id), Math.max(a.id, b.id)].join('-')).sort()
      expect(key(spatialHashPairs(64)(ents))).toEqual(key(naivePairs(ents)))
    }
  })
  test('мертві й знищені кораблі не стикаються', () => {
    const a = new Ship({ x: 0, y: 0 })
    const b = new Ship({ x: 1, y: 0 })
    b.respawnIn = 1
    expect(naivePairs([a, b])).toEqual([])
  })
})

describe('World.step', () => {
  test('детермінізм: клон світу з тим самим seed дає той самий стан (наївні колізії і хеш)', () => {
    const run = (spatial: boolean) => {
      const w = new World({
        seed: 11,
        ...(spatial ? { collide: spatialHashPairs() } : {}),
      })
      w.populate({ asteroids: 6, homingAsteroids: 1 })
      const s = w.spawn(new Ship({ x: 100, y: 100 }))
      for (let i = 0; i < 600; i++) {
        s.controls = {
          thrust: i % 3 > 0,
          left: i % 40 < 8,
          right: false,
          fire: i % 6 === 0,
        }
        w.step(1 / 30)
      }
      return [...w]
        .map((e) => `${e.kind}:${e.pos.x.toFixed(5)},${e.pos.y.toFixed(5)}`)
        .join('|')
    }
    expect(run(false)).toBe(run(false))
    expect(run(true)).toBe(run(false))
  })
})

describe('пул частинок', () => {
  test("acquire/release перевикористовує об'єкти", () => {
    let n = 0
    const p = new Pool(() => ({ id: ++n }), 2)
    const a = p.acquire()
    p.release(a)
    expect(p.acquire()).toBe(a)
    p.acquire()
    p.acquire() // третій — новий
    expect(p.created).toBe(3)
  })
  test('вибухи повертають частинки в пул', () => {
    const w = new World()
    const before = particlePool.created
    for (let k = 0; k < 50; k++) {
      w.explode(new Vector2(100, 100), '#fff')
      for (let i = 0; i < 40; i++) w.step(1 / 30)
    }
    // 50 вибухів × 24 частинки = 1200, але пул перевикористовує ті самі об'єкти
    expect(particlePool.created - before).toBeLessThanOrEqual(24)
  })
})

test('великий бій: просторовий хеш і O(n²) дають однаковий світ (порядок пар однаковий)', () => {
  const run = (spatial: boolean) => {
    const w = new World({ seed: 3, ...(spatial ? { collide: spatialHashPairs() } : {}) })
    w.populate({ asteroids: 30, homingAsteroids: 2 })
    const ships = Array.from({ length: 40 }, (_, i) =>
      w.spawn(new Ship({ x: (i * 97) % 1280, y: (i * 53) % 720 })),
    )
    for (let t = 0; t < 300; t++) {
      ships.forEach(
        (s, i) =>
          (s.controls = {
            thrust: (t + i) % 4 > 0,
            left: (t + i) % 50 < 9,
            right: false,
            fire: (t + i) % 5 === 0,
          }),
      )
      w.step(1 / 30)
    }
    return `${w.size}|` + [...w].map((e) => `${e.kind}:${e.pos.x.toFixed(4)}`).join(',')
  }
  expect(run(true)).toBe(run(false))
})
