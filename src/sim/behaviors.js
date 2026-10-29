import { Vector2 } from './vector.js'

/**
 * Композиція: поведінка — це дані на сутності + функція-система.
 * Будь-якій сутності з полем `homing` система доворачує швидкість
 * до найближчої цілі. Однаково працює для кулі й для астероїда.
 */
export function makeHoming({ targetKind = 'ship', turnRate = 2.5, range = 420 } = {}) {
  return { targetKind, turnRate, range }
}

export function homingSystem(world, dt) {
  for (const e of world) {
    if (!e.homing || !e.alive) continue
    const { targetKind, turnRate, range } = e.homing
    let best = null
    let bestD = range
    for (const t of world.ofKind(targetKind)) {
      if (t === e || t.dead || (e.owner !== undefined && t.id === e.owner)) continue
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

/** Ефекти підбирання: таблиця «назва → дія», нова фіча = новий рядок. */
export const PICKUP_EFFECTS = {
  shield: (ship, d) => (ship.shield = Math.max(ship.shield, d)),
  rapid: (ship, d) => (ship.rapid = Math.max(ship.rapid, d)),
  homing: (ship, d) => (ship.homingShots = Math.max(ship.homingShots, d)),
}
