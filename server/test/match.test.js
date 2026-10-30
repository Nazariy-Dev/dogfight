import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { decodeSnapshot, encodeInput } from '@dogfight/shared/protocol/codec.js'
import { createTicker } from '../src/timer.js'
import { Match } from '../src/match.js'
import { startTestServer, client } from './helpers.js'

const srv = await startTestServer()
after(() => srv.app.shutdown())

test('бінарний input 30/с: сервер рухає корабель і шле знімки з ackSeq', async () => {
  const c = client(srv.wsUrl)
  await c.opened
  c.send({ type: 'join', room: 'm1', name: 'Pilot' })
  const w = await c.waitFor((m) => m.type === 'welcome')
  assert.ok(Number.isInteger(w.ship))
  let seq = 0
  const iv = setInterval(
    () => c.ws.send(encodeInput({ seq: ++seq, thrust: true })),
    1000 / 30,
  )
  await new Promise((r) => setTimeout(r, 1000))
  clearInterval(iv)
  await new Promise((r) => setTimeout(r, 100))
  assert.equal(c.ws.readyState, 1, 'не закрито ліміт-ом')
  const snaps = c.binary.map((b) => decodeSnapshot(new Uint8Array(b)))
  assert.ok(snaps.length >= 25, `snapshots=${snaps.length}`)
  const last = snaps.at(-1)
  assert.ok(last.ackSeq >= seq - 3, `ack ${last.ackSeq} vs sent ${seq}`)
  const first = snaps[0].entities.find((e) => e.id === w.ship)
  const now = last.entities.find((e) => e.id === w.ship)
  assert.ok(
    Math.hypot(now.vx, now.vy) > Math.hypot(first.vx, first.vy) + 50,
    'газ подіяв',
  )
  c.ws.close()
})

test('битий бінарний кадр → close 4000', async () => {
  const c = client(srv.wsUrl)
  await c.opened
  c.send({ type: 'join', room: 'm2', name: 'X' })
  await c.waitFor((m) => m.type === 'welcome')
  c.ws.send(new Uint8Array([9, 9, 9]))
  assert.equal((await c.closed).code, 4000)
})

test('Match.input: старий або дубльований seq відкидається', () => {
  const m = new Match({ room: 't', send: () => {} })
  m.addPlayer({ id: 'p' })
  assert.equal(m.input('p', { seq: 1 }), true)
  assert.equal(m.input('p', { seq: 1 }), false)
  assert.equal(m.input('p', { seq: 0 }), false)
  assert.equal(m.input('nobody', { seq: 5 }), false)
  m.stop()
})

test('ticker: 30 Гц за абсолютним часом, без дрейфу', async () => {
  let n = 0
  const t = createTicker(1000 / 30, () => n++)
  t.start()
  await new Promise((r) => setTimeout(r, 1000))
  t.stop()
  assert.ok(n >= 29 && n <= 31, `ticks=${n}`)
})
