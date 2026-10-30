// Параметри керування підібрано вручну (див. README, розділ «Налаштування»).
export const ROTATE_SPEED = 3.4 // рад/с: повний оберт ≈ 1,85 с
export const THRUST = 480 // px/с²: до 300 px/с за ~0,8 с
export const DRAG = 0.9 // 1/с: експоненційне гальмування без газу
export const MAX_SPEED = 360 // px/с: обмеження швидкості

/** Корабель — звичайний об'єкт даних, без методів і без DOM. */
export function createShip({ x = 0, y = 0, angle = -Math.PI / 2 } = {}) {
  return { x, y, vx: 0, vy: 0, angle, thrusting: false }
}

export function cloneShip(s) {
  return { x: s.x, y: s.y, vx: s.vx, vy: s.vy, angle: s.angle, thrusting: s.thrusting }
}

/**
 * Один крок фізики. Залежить лише від стану, керування і dt,
 * тому однаковий вхід завжди дає однаковий результат.
 * controls = { left, right, thrust }
 */
export function integrate(ship, controls, dt) {
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

  ship.x += ship.vx * dt
  ship.y += ship.vy * dt
  return ship
}
