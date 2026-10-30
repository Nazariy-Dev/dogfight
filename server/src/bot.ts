import type { World } from '@dogfight/shared/sim/world.ts'
import type { Ship } from '@dogfight/shared/sim/entity.ts'
import { NO_CONTROLS, type Controls } from '@dogfight/shared/types.ts'
import { wrappedDelta } from '@dogfight/shared/net/reconcile.ts'

/** Будь-яке джерело input — людина через мережу чи бот — має однаковий інтерфейс. */
export interface PlayerInput {
  next(world: World, me: Ship): Controls
}

/**
 * Бот: наздоганяє найближчий корабель, стріляє, коли ціль перед носом,
 * ухиляється від близьких астероїдів. Детермінований (без Math.random).
 */
export class Bot implements PlayerInput {
  next(world: World, me: Ship): Controls {
    if (me.dead) return NO_CONTROLS
    let target: Ship | null = null
    let best = Infinity
    for (const s of world.listOfKind('ship')) {
      if (s === me || s.dead) continue
      const d = wrappedDelta(me.pos, s.pos, world.w, world.h).d
      if (d < best) {
        best = d
        target = s
      }
    }
    for (const a of world.listOfKind('asteroid')) {
      const { dx, dy, d } = wrappedDelta(me.pos, a.pos, world.w, world.h)
      if (d < a.radius + 60) return this.#steer(me, Math.atan2(-dy, -dx), true, false) // тікаємо
    }
    if (!target) return { ...NO_CONTROLS, thrust: world.tick % 60 < 20 }
    const { dx, dy } = wrappedDelta(me.pos, target.pos, world.w, world.h)
    return this.#steer(me, Math.atan2(dy, dx), best > 150, best < 500)
  }

  #steer(me: Ship, want: number, thrust: boolean, fireIfAimed: boolean): Controls {
    let diff = want - me.angle
    diff = Math.atan2(Math.sin(diff), Math.cos(diff))
    return {
      left: diff < -0.05,
      right: diff > 0.05,
      thrust,
      fire: fireIfAimed && Math.abs(diff) < 0.15,
    }
  }
}
