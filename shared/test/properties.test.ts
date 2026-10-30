import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import {
  CodecError,
  ENTITY_BYTES,
  INPUT_BYTES,
  KINDS,
  SNAP_HEADER,
  decodeInput,
  decodeSnapshot,
  encodeInput,
  encodeSnapshot,
  type SnapEntity,
  type Snapshot,
} from '../src/protocol/codec.ts'
import { parseClientMessage } from '../src/protocol/messages.ts'
import { asEntityId, asSeq, asTick } from '../src/types.ts'
import { integrate, MAX_SPEED } from '../src/sim/ship.ts'
import { mod } from '../src/sim/arena.ts'
import { World } from '../src/sim/world.ts'
import { Ship } from '../src/sim/entity.ts'

const f32 = fc.float({ min: -1e5, max: 1e5, noNaN: true, noDefaultInfinity: true })
const entityArb: fc.Arbitrary<SnapEntity> = fc.record({
  id: fc.integer({ min: 0, max: 0xffffffff }).map(asEntityId),
  kind: fc.constantFrom(...KINDS),
  x: f32,
  y: f32,
  vx: f32,
  vy: f32,
  angle: fc.double({ min: -100, max: 100, noNaN: true }),
  hp: fc.integer({ min: 0, max: 255 }),
  flags: fc.integer({ min: 0, max: 15 }),
})
const snapArb: fc.Arbitrary<Snapshot> = fc.record({
  tick: fc.integer({ min: 0, max: 0xffffffff }).map(asTick),
  ackSeq: fc.integer({ min: 0, max: 0xffffffff }).map(asSeq),
  entities: fc.array(entityArb, { maxLength: 40 }),
})
const controlsArb = fc.record({
  left: fc.boolean(),
  right: fc.boolean(),
  thrust: fc.boolean(),
  fire: fc.boolean(),
})

const angleDiff = (a: number, b: number): number =>
  Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))

describe('властивості протоколу (fast-check)', () => {
  test('P1: decode(encode(snapshot)) ≈ snapshot з урахуванням float32 і квантування кута', () => {
    fc.assert(
      fc.property(snapArb, (s) => {
        const d = decodeSnapshot(encodeSnapshot(s))
        expect(d.tick).toBe(s.tick)
        expect(d.ackSeq).toBe(s.ackSeq)
        expect(d.entities.length).toBe(s.entities.length)
        d.entities.forEach((e, i) => {
          const o = s.entities[i]!
          expect(e.id).toBe(o.id)
          expect(e.kind).toBe(o.kind)
          expect(e.x).toBe(Math.fround(o.x))
          expect(e.vy).toBe(Math.fround(o.vy))
          expect(angleDiff(e.angle, o.angle)).toBeLessThan(1e-4)
          expect(e.hp).toBe(o.hp)
          expect(e.flags).toBe(o.flags)
        })
      }),
      { numRuns: 300 },
    )
  })

  test('P2: довжина кадру = 12 + 25·N; input — завжди 7 байтів', () => {
    fc.assert(
      fc.property(
        snapArb,
        (s) =>
          encodeSnapshot(s).byteLength === SNAP_HEADER + ENTITY_BYTES * s.entities.length,
      ),
    )
    fc.assert(
      fc.property(controlsArb, fc.integer({ min: 0, max: 0xffffffff }), (c, seq) => {
        const buf = encodeInput({ ...c, seq: asSeq(seq) })
        expect(buf.byteLength).toBe(INPUT_BYTES)
        expect(decodeInput(buf)).toEqual({ ...c, seq })
      }),
    )
  })

  test('P3: довільні байти → CodecError або коректний знімок, ніколи інший виняток', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), (bytes) => {
        for (const decode of [decodeSnapshot, decodeInput]) {
          try {
            decode(bytes)
          } catch (err) {
            expect(err).toBeInstanceOf(CodecError)
          }
        }
      }),
      { numRuns: 2000 },
    )
  })

  test('P3b: зіпсований один байт валідного знімка → CodecError або знімок тієї ж довжини', () => {
    fc.assert(
      fc.property(snapArb, fc.nat(), fc.integer({ min: 0, max: 255 }), (s, pos, val) => {
        const bytes = new Uint8Array(encodeSnapshot(s))
        if (bytes.length === 0) return
        bytes[pos % bytes.length] = val
        try {
          const d = decodeSnapshot(bytes)
          expect(SNAP_HEADER + ENTITY_BYTES * d.entities.length).toBe(bytes.length)
        } catch (err) {
          expect(err).toBeInstanceOf(CodecError)
        }
      }),
    )
  })

  test('P4: корабель лишається в арені за 1000 випадкових кроків', () => {
    fc.assert(
      fc.property(
        fc.array(controlsArb, { minLength: 1000, maxLength: 1000 }),
        (inputs) => {
          const w = 1280
          const h = 720
          const s = { x: 640, y: 360, vx: 0, vy: 0, angle: 0 }
          for (const c of inputs) {
            integrate(s, c, 1 / 30)
            s.x = mod(s.x, w)
            s.y = mod(s.y, h)
            if (!(s.x >= 0 && s.x < w && s.y >= 0 && s.y < h)) return false
            if (Math.hypot(s.vx, s.vy) > MAX_SPEED + 1e-6) return false
          }
          return true
        },
      ),
      { numRuns: 50 },
    )
  })

  test('P4b: World — усі сутності в арені після випадкової гри', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1e6 }),
        fc.array(controlsArb, { minLength: 200, maxLength: 200 }),
        (seed, inputs) => {
          const world = new World({ seed })
          world.populate({ asteroids: 4, homingAsteroids: 1 })
          const ship = world.spawn(new Ship({ x: 100, y: 100 }))
          for (const c of inputs) {
            ship.controls = c
            world.step(1 / 30)
          }
          for (const e of world) {
            if (!(e.pos.x >= 0 && e.pos.x < world.w && e.pos.y >= 0 && e.pos.y < world.h))
              return false
          }
          return true
        },
      ),
      { numRuns: 30 },
    )
  })

  const validMsg = fc.oneof(
    fc.record({
      v: fc.constant(0),
      type: fc.constant('join'),
      room: fc.stringMatching(/^[a-z0-9-]{1,24}$/),
      name: fc.string({ minLength: 1, maxLength: 16 }),
    }),
    fc.record({
      v: fc.constant(0),
      type: fc.constant('chat'),
      text: fc.string({ minLength: 1, maxLength: 200 }),
    }),
    fc.record({ v: fc.constant(0), type: fc.constant('leave') }),
    fc.record({
      v: fc.constant(0),
      type: fc.constant('input'),
      seq: fc.integer({ min: 0, max: 0xffffffff }),
      left: fc.boolean(),
      right: fc.boolean(),
      thrust: fc.boolean(),
      fire: fc.boolean(),
    }),
  )

  test('P5: parseClientMessage приймає кожне валідне повідомлення', () => {
    fc.assert(
      fc.property(validMsg, (m) => parseClientMessage(JSON.stringify(m), 1 << 16).ok),
    )
  })

  test('P5b: і відхиляє зіпсовану копію (без поля, з чужим типом поля, з іншою версією)', () => {
    fc.assert(
      fc.property(
        validMsg,
        fc.nat(),
        fc.constantFrom('drop', 'retype', 'version'),
        (m, i, how) => {
          const copy: Record<string, unknown> = { ...m }
          const keys = Object.keys(copy).filter((k) => k !== 'type')
          const k = keys[i % keys.length]!
          if (how === 'version') copy.v = 1
          else if (how === 'drop') {
            if (k === 'v' || m.type === 'leave') copy.v = 'x'
            else delete copy[k]
          } else copy[k] = typeof copy[k] === 'string' ? 42 : 'oops'
          return parseClientMessage(JSON.stringify(copy), 1 << 16).ok === false
        },
      ),
    )
  })
})
