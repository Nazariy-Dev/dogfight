import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  CodecError,
  ENTITY_BYTES,
  SNAP_HEADER,
  decodeInput,
  decodeSnapshot,
  dequantizeAngle,
  encodeInput,
  encodeSnapshot,
  quantizeAngle,
  type SnapEntity,
} from '../src/protocol/codec.ts'
import { asEntityId, asSeq, asTick } from '../src/types.ts'
import { World } from '../src/sim/world.ts'
import { Ship } from '../src/sim/entity.ts'
import { createRng } from '../src/sim/rng.ts'
import { worldToEntities } from '../src/net/snapshot.ts'
import { predictStep, reconcile } from '../src/net/reconcile.ts'
import { SnapshotBuffer } from '../src/net/interpolation.ts'

const DT = 1 / 30

test('sim імпортується в Node без DOM', () => {
  assert.equal('document' in globalThis, false)
  assert.equal(typeof World, 'function')
})

test('rng: однаковий seed → однакова послідовність', () => {
  const a = createRng(5)
  const b = createRng(5)
  const xs = Array.from({ length: 5 }, () => a.next())
  assert.deepEqual(
    xs,
    Array.from({ length: 5 }, () => b.next()),
  )
  assert.ok(xs.every((x) => x >= 0 && x < 1))
})

function runHash(seed: number): string {
  const w = new World({ seed })
  w.populate({ asteroids: 4, homingAsteroids: 1 })
  const s1 = w.spawn(new Ship({ x: 200, y: 200 }))
  const s2 = w.spawn(new Ship({ x: 900, y: 400 }))
  for (let i = 0; i < 900; i++) {
    s1.controls = {
      thrust: i % 4 < 2,
      left: i % 90 < 20,
      right: false,
      fire: i % 7 === 0,
    }
    s2.controls = { thrust: true, left: false, right: i % 60 < 15, fire: i % 11 === 0 }
    w.step(DT)
  }
  const ents = worldToEntities(w).map((e) => ({ ...e, id: 0 })) // id глобальні між прогонами
  return createHash('sha256').update(JSON.stringify(ents)).digest('hex').slice(0, 16)
}

test('детермінізм: однаковий seed і input → однаковий хеш стану', () => {
  assert.equal(runHash(3), runHash(3))
  assert.notEqual(runHash(3), runHash(4))
})

test('input: round-trip і довжина 7 байтів', () => {
  const m = { seq: asSeq(4294967295), left: true, right: false, thrust: true, fire: true }
  const buf = encodeInput(m)
  assert.equal(buf.byteLength, 7)
  assert.deepEqual(decodeInput(buf), m)
})

test('snapshot: round-trip у межах квантування', () => {
  const entities: SnapEntity[] = [
    {
      id: asEntityId(1),
      kind: 'ship',
      x: 10.5,
      y: 700.25,
      vx: -3,
      vy: 360,
      angle: Math.PI,
      hp: 75,
      flags: 5,
    },
    {
      id: asEntityId(2),
      kind: 'bullet',
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      angle: -2.5,
      hp: 0,
      flags: 0,
    },
    {
      id: asEntityId(65536),
      kind: 'pickup',
      x: 1,
      y: 2,
      vx: 0,
      vy: 0,
      angle: 7,
      hp: 2,
      flags: 0,
    },
  ]
  const buf = encodeSnapshot({ tick: asTick(42), ackSeq: asSeq(41), entities })
  assert.equal(buf.byteLength, SNAP_HEADER + ENTITY_BYTES * 3)
  const d = decodeSnapshot(buf)
  assert.equal(d.tick, 42)
  assert.equal(d.ackSeq, 41)
  d.entities.forEach((e, i) => {
    const s = entities[i]!
    assert.equal(e.id, s.id)
    assert.equal(e.kind, s.kind)
    assert.ok(Math.abs(e.x - s.x) < 1e-3 && Math.abs(e.vy - s.vy) < 1e-3)
    const da = Math.abs(
      Math.atan2(Math.sin(e.angle - s.angle), Math.cos(e.angle - s.angle)),
    )
    assert.ok(da < 1e-4, `angle ${s.angle} → ${e.angle}`)
  })
})

test('кут Int16: крок квантування < 1e-4 рад', () => {
  for (const a of [0, 1, -1, 3.14159, -3.14159, 100]) {
    const back = dequantizeAngle(quantizeAngle(a))
    assert.ok(Math.abs(Math.sin(back) - Math.sin(a)) < 1e-4)
  }
})

test('декодер: версія, тип, довжина, kind — CodecError, а не падіння', () => {
  const good = new Uint8Array(
    encodeSnapshot({
      tick: asTick(1),
      ackSeq: asSeq(1),
      entities: [
        {
          id: asEntityId(1),
          kind: 'ship',
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          angle: 0,
          hp: 0,
          flags: 0,
        },
      ],
    }),
  )
  const bad = [
    new Uint8Array([]),
    new Uint8Array([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    good.slice(0, good.length - 1),
    Object.assign(good.slice(), { 16: 99 }),
    new Uint8Array([1, 1, 0, 0, 0, 0, 255]),
    new Uint8Array([1, 2, 1]),
  ]
  for (const b of bad)
    assert.throws(() => (b.length === 7 ? decodeInput(b) : decodeSnapshot(b)), CodecError)
  assert.throws(() => decodeSnapshot('hello'), CodecError)
  assert.throws(
    // навмисно неправильні дані з «мережі»: обходимо типи через JSON
    () => encodeSnapshot(JSON.parse('{"tick":0,"ackSeq":0,"entities":[{"kind":"ufo"}]}')),
    CodecError,
  )
})

test('reconcile: нульова поправка, якщо передбачення = сервер', () => {
  const W = 1280
  const H = 720
  const inputs = Array.from({ length: 10 }, (_, i) => ({
    seq: asSeq(i + 1),
    thrust: true,
    left: i % 2 === 0,
    right: false,
    fire: false,
  }))
  const truth = { x: 100, y: 100, vx: 0, vy: 0, angle: 0 }
  const client = { ...truth }
  for (const i of inputs) predictStep(client, i, DT, W, H)
  // сервер обробив перші 6
  const server = { ...truth }
  for (const i of inputs.slice(0, 6)) predictStep(server, i, DT, W, H)
  const r = reconcile(server, asSeq(6), inputs, DT, W, H)
  assert.equal(r.pending.length, 4)
  assert.ok(
    Math.abs(r.state.x - client.x) < 1e-9 && Math.abs(r.state.y - client.y) < 1e-9,
  )
})

test('SnapshotBuffer: інтерполяція посередині і через край арени', () => {
  // generic-буфер працює з будь-якою формою { id, x, y, angle }
  const b = new SnapshotBuffer<{ id: number; x: number; y: number; angle: number }>()
  b.push(0, [{ id: 1, x: 1270, y: 10, angle: 3.1 }])
  b.push(100, [
    { id: 1, x: 10, y: 10, angle: -3.1 },
    { id: 2, x: 5, y: 5, angle: 0 },
  ])
  const mid = b.sample(50, 1280, 720)
  const e1 = mid.find((e) => e.id === 1)
  assert.ok(e1)
  assert.ok(Math.abs(e1.x - 0) < 1e-6 || Math.abs(e1.x - 1280) < 1e-6, `x=${e1.x}`)
  assert.ok(Math.abs(Math.abs(e1.angle) - Math.PI) < 0.01)
  assert.ok(
    mid.find((e) => e.id === 2),
    'нова сутність показана без інтерполяції',
  )
  assert.equal(new SnapshotBuffer().sample(0, 1, 1).length, 0)
})
