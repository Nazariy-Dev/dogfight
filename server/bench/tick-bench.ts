// Час кроку сервера без мережі: N ботів, A астероїдів, наївні колізії vs просторовий хеш.
// node bench/tick-bench.ts
import { World } from '@dogfight/shared/sim/world.ts'
import { Ship } from '@dogfight/shared/sim/entity.ts'
import { naivePairs } from '@dogfight/shared/sim/collision.ts'
import { spatialHashPairs } from '@dogfight/shared/sim/spatial.ts'
import { worldToEntities } from '@dogfight/shared/net/snapshot.ts'
import { encodeSnapshot } from '@dogfight/shared/protocol/codec.ts'
import { asSeq } from '@dogfight/shared/types.ts'
import { percentile } from '../src/timer.ts'
import { Bot } from '../src/bot.ts'

function run(
  bots: number,
  asteroids: number,
  collide: 'naive' | 'spatial',
  ticks = 1800,
) {
  const world = new World({
    seed: 5,
    collide: collide === 'naive' ? naivePairs : spatialHashPairs(),
  })
  world.populate({ asteroids, homingAsteroids: 0 })
  const crew = Array.from({ length: bots }, (_, i) => ({
    bot: new Bot(),
    ship: world.spawn(new Ship({ x: (i * 97) % 1280, y: (i * 53) % 720 })),
  }))
  const dur: number[] = []
  let ents = 0
  for (let t = 0; t < ticks; t++) {
    const t0 = performance.now()
    for (const c of crew) c.ship.controls = c.bot.next(world, c.ship)
    world.step(1 / 30)
    encodeSnapshot({
      tick: world.tick,
      ackSeq: asSeq(0),
      entities: worldToEntities(world),
    })
    dur.push(performance.now() - t0)
    ents = Math.max(ents, world.size)
  }
  return { p50: percentile(dur, 0.5), p99: percentile(dur, 0.99), maxEntities: ents }
}

console.log('bots | asteroids | collisions | max entities | tick p50, ms | tick p99, ms')
for (const [b, a] of [
  [8, 4],
  [32, 20],
  [128, 60],
] as const) {
  for (const c of ['naive', 'spatial'] as const) {
    run(b, a, c, 300) // прогрів JIT
    const r = run(b, a, c)
    console.log(
      `${String(b).padStart(4)} | ${String(a).padStart(9)} | ${c.padEnd(10)} | ${String(r.maxEntities).padStart(12)} | ${r.p50.toFixed(3).padStart(12)} | ${r.p99.toFixed(3).padStart(12)}`,
    )
  }
}
