// Профіль 60 с гри (1800 кроків, 128 ботів): node --cpu-prof --cpu-prof-dir=prof bench/profile-tick.ts
import { World } from '@dogfight/shared/sim/world.ts'
import { Ship } from '@dogfight/shared/sim/entity.ts'
import { spatialHashPairs } from '@dogfight/shared/sim/spatial.ts'
import { naivePairs } from '@dogfight/shared/sim/collision.ts'
import { worldToEntities } from '@dogfight/shared/net/snapshot.ts'
import { encodeSnapshot } from '@dogfight/shared/protocol/codec.ts'
import { asSeq } from '@dogfight/shared/types.ts'
import { Bot } from '../src/bot.ts'

const world = new World({
  seed: 5,
  collide: process.env.COLLISIONS === 'naive' ? naivePairs : spatialHashPairs(),
})
world.populate({ asteroids: 60, homingAsteroids: 0 })
const crew = Array.from({ length: 128 }, (_, i) => ({
  bot: new Bot(),
  ship: world.spawn(new Ship({ x: (i * 97) % 1280, y: (i * 53) % 720 })),
}))
for (let t = 0; t < 1800; t++) {
  for (const c of crew) c.ship.controls = c.bot.next(world, c.ship)
  world.step(1 / 30)
  encodeSnapshot({ tick: world.tick, ackSeq: asSeq(0), entities: worldToEntities(world) })
}
console.log('entities', world.size)
