import { Vector2 } from './vector.ts'
import type { EntityKind, Ship, PickupEffect } from './entity.ts'
import type { World } from './world.ts'

/** Компонент самонаведення — дані, які можна повісити на кулю або астероїд. */
export interface Homing {
  readonly targetKind: EntityKind
  readonly turnRate: number
  readonly range: number
}

export function makeHoming({
  targetKind = 'ship',
  turnRate = 2.5,
  range = 420,
}: Partial<Homing> = {}): Homing {
  return { targetKind, turnRate, range }
}

export function homingSystem(world: World, dt: number): void {
  for (const e of world) {
    if (!e.homing || !e.alive) continue
    const { targetKind, turnRate, range } = e.homing
    const owner = e.kind === 'bullet' ? e.owner : null
    let best: { pos: Vector2 } | null = null
    let bestD = range
    for (const t of world.ofKind(targetKind)) {
      if (t === e || (t.kind === 'ship' && t.dead) || t.id === owner) continue
      const d = t.pos.sub(e.pos).length()
      if (d < bestD) {
        best = t
        bestD = d
      }
    }
    if (!best) continue
    const speed = e.vel.length()
    const want = Math.atan2(best.pos.y - e.pos.y, best.pos.x - e.pos.x)
    const cur = Math.atan2(e.vel.y, e.vel.x)
    let diff = want - cur
    while (diff > Math.PI) diff -= 2 * Math.PI
    while (diff < -Math.PI) diff += 2 * Math.PI
    const turn = Math.max(-turnRate * dt, Math.min(turnRate * dt, diff))
    e.vel = Vector2.fromAngle(cur + turn, speed)
  }
}

/** Ефекти підбирання: Record за union-типом — пропущений ефект буде помилкою tsc. */
export const PICKUP_EFFECTS: Record<
  PickupEffect,
  (ship: Ship, duration: number) => void
> = {
  shield: (ship, d) => void (ship.shield = Math.max(ship.shield, d)),
  rapid: (ship, d) => void (ship.rapid = Math.max(ship.rapid, d)),
  homing: (ship, d) => void (ship.homingShots = Math.max(ship.homingShots, d)),
}
