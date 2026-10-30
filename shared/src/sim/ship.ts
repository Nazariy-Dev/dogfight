import type { Controls } from '../types.ts'

export const ROTATE_SPEED = 3.4 // рад/с
export const THRUST = 480 // px/с²
export const DRAG = 0.9 // 1/с
export const MAX_SPEED = 360 // px/с

/** Експеримент Lab 5: noise > 0 ламає детермінізм (Math.random у integrate). У грі 0. */
export const simDebug = { noise: 0 }

/** Фізичний стан корабля — плаский об'єкт, без DOM. */
export interface ShipState {
  x: number
  y: number
  vx: number
  vy: number
  angle: number
  thrusting?: boolean
}

export function createShip({
  x = 0,
  y = 0,
  angle = -Math.PI / 2,
} = {}): Required<ShipState> {
  return { x, y, vx: 0, vy: 0, angle, thrusting: false }
}

export function cloneShip(s: Required<ShipState>): Required<ShipState> {
  return { x: s.x, y: s.y, vx: s.vx, vy: s.vy, angle: s.angle, thrusting: s.thrusting }
}

/** Один крок фізики: чиста функція стану, керування і dt (мутує state). */
export function integrate<S extends ShipState>(
  ship: S,
  controls: Partial<Controls>,
  dt: number,
): S {
  if (controls.left) ship.angle -= ROTATE_SPEED * dt
  if (controls.right) ship.angle += ROTATE_SPEED * dt

  ship.thrusting = !!controls.thrust
  if (ship.thrusting) {
    ship.vx += Math.cos(ship.angle) * THRUST * dt
    ship.vy += Math.sin(ship.angle) * THRUST * dt
  }

  const damp = Math.exp(-DRAG * dt)
  ship.vx *= damp
  ship.vy *= damp

  const speed = Math.hypot(ship.vx, ship.vy)
  if (speed > MAX_SPEED) {
    const k = MAX_SPEED / speed
    ship.vx *= k
    ship.vy *= k
  }

  if (simDebug.noise) {
    ship.vx += (Math.random() - 0.5) * simDebug.noise
    ship.vy += (Math.random() - 0.5) * simDebug.noise
  }

  ship.x += ship.vx * dt
  ship.y += ship.vy * dt
  return ship
}
