import { wrapPi } from '../protocol/codec.js'

export const FLAG = { THRUST: 1, DEAD: 2, SHIELD: 4, HOMING: 8 }

/** Стан світу → плаский масив записів знімка (спільне для обох кодеків). */
export function worldToEntities(world) {
  const out = []
  for (const e of world) {
    if (!e.alive) continue
    out.push({
      id: e.id,
      kind: e.kind,
      x: e.pos.x,
      y: e.pos.y,
      vx: e.vel.x,
      vy: e.vel.y,
      angle: wrapPi(e.angle),
      hp:
        e.kind === 'ship'
          ? e.hp
          : e.kind === 'pickup'
            ? ['shield', 'rapid', 'homing'].indexOf(e.pickup.effect)
            : (e.size ?? 0),
      flags:
        (e.thrusting ? FLAG.THRUST : 0) |
        (e.dead ? FLAG.DEAD : 0) |
        (e.shield > 0 ? FLAG.SHIELD : 0) |
        (e.homing ? FLAG.HOMING : 0),
    })
  }
  return out
}
