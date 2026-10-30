// JSON vs бінарний знімок: розмір і час encode+decode. node scripts/codec-bench.js
import { World } from '../src/sim/world.ts'
import { Ship } from '../src/sim/entity.ts'
import { worldToEntities } from '../src/net/snapshot.ts'
import { binaryCodec, type Codec } from '../src/protocol/codec.ts'
import { jsonCodec } from '../src/protocol/messages.ts'
import { asSeq, asTick } from '../src/types.ts'

const world = new World({ seed: 1 })
world.populate({ asteroids: 4, homingAsteroids: 0 })
const ships = [0, 1, 2, 3].map((i) => world.spawn(new Ship({ x: 200 + i * 250, y: 360 })))
// 3 с гри: усі газують і стріляють — у знімку є кулі
for (let i = 0; i < 90; i++) {
  ships.forEach(
    (s, k) =>
      (s.controls = { thrust: true, left: k % 2 === 0, right: false, fire: true }),
  )
  world.step(1 / 30)
}
const snap = {
  tick: asTick(world.tick),
  ackSeq: asSeq(1234),
  entities: worldToEntities(world),
}
const inp = { seq: asSeq(1234), left: true, right: false, thrust: true, fire: false }
console.log(`сутностей у знімку: ${snap.entities.length}`)
console.log('codec  | bytes/snapshot | KB/s down | bytes/input | KB/s up | enc+dec µs')
const codecs: ReadonlyArray<readonly [string, Codec]> = [
  ['JSON  ', jsonCodec],
  ['binary', binaryCodec],
]
for (const [name, c] of codecs) {
  const enc = c.encodeSnapshot(snap)
  const size = typeof enc === 'string' ? Buffer.byteLength(enc) : enc.byteLength
  const ienc = c.encodeInput(inp)
  const isize = typeof ienc === 'string' ? Buffer.byteLength(ienc) : ienc.byteLength
  const N = 20000
  for (let i = 0; i < 2000; i++) c.decodeSnapshot(c.encodeSnapshot(snap)) // прогрів JIT
  const t = performance.now()
  for (let i = 0; i < N; i++) c.decodeSnapshot(c.encodeSnapshot(snap))
  const us = ((performance.now() - t) * 1000) / N
  console.log(
    `${name} | ${String(size).padStart(14)} | ${((size * 30) / 1024).toFixed(1).padStart(9)} | ${String(isize).padStart(11)} | ${((isize * 30) / 1024).toFixed(2).padStart(7)} | ${us.toFixed(1).padStart(10)}`,
  )
}
