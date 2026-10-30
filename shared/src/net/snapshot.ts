import { wrapPi, type SnapEntity } from '../protocol/codec.ts'
import { PICKUP_EFFECTS_LIST, type Entity } from '../sim/entity.ts'
import { assertNever } from '../types.ts'

export const FLAG = { THRUST: 1, DEAD: 2, SHIELD: 4, HOMING: 8 } as const

/** Поле hp у знімку має різний зміст для різних видів — вичерпний switch з never. */
function hpField(e: Entity): number {
  switch (e.kind) {
    case 'ship':
      return e.hp
    case 'asteroid':
      return e.size
    case 'pickup':
      return PICKUP_EFFECTS_LIST.indexOf(e.pickup.effect)
    case 'bullet':
    case 'explosion':
      return 0
    default:
      return assertNever(e, 'entity kind')
  }
}

export function toSnapEntity(e: Entity): SnapEntity {
  const ship = e.kind === 'ship' ? e : null
  return {
    id: e.id,
    kind: e.kind,
    x: e.pos.x,
    y: e.pos.y,
    vx: e.vel.x,
    vy: e.vel.y,
    angle: wrapPi(e.angle),
    hp: hpField(e),
    flags:
      (ship?.thrusting ? FLAG.THRUST : 0) |
      (ship?.dead ? FLAG.DEAD : 0) |
      (ship && ship.shield > 0 ? FLAG.SHIELD : 0) |
      (e.homing ? FLAG.HOMING : 0),
  }
}

export function worldToEntities(world: Iterable<Entity>): SnapEntity[] {
  const out: SnapEntity[] = []
  for (const e of world) if (e.alive) out.push(toSnapEntity(e))
  return out
}
