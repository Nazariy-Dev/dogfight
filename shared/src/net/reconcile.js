import { integrate } from '../sim/ship.js'
import { mod } from '../sim/arena.js'

/**
 * Передбачення одного кроку власного корабля — ТА САМА функція integrate,
 * що й на сервері, плюс загортання країв.
 */
export function predictStep(state, input, dt, w, h) {
  integrate(state, input, dt)
  state.x = mod(state.x, w)
  state.y = mod(state.y, h)
  return state
}

/**
 * Звірка (reconciliation) як чиста функція.
 * server — стан корабля зі знімка, ackSeq — останній оброблений сервером seq,
 * pending — непідтверджені input [{seq, ...}].
 * Повертає новий передбачений стан і список input, що лишились непідтвердженими.
 */
export function reconcile(server, ackSeq, pending, dt, w, h) {
  const rest = pending.filter((p) => p.seq > ackSeq)
  const s = {
    x: server.x,
    y: server.y,
    vx: server.vx,
    vy: server.vy,
    angle: server.angle,
  }
  for (const inp of rest) predictStep(s, inp, dt, w, h)
  return { state: s, pending: rest }
}

/** Відстань з урахуванням загортання арени. */
export function wrappedDelta(a, b, w, h) {
  let dx = b.x - a.x
  let dy = b.y - a.y
  if (dx > w / 2) dx -= w
  if (dx < -w / 2) dx += w
  if (dy > h / 2) dy -= h
  if (dy < -h / 2) dy += h
  return { dx, dy, d: Math.hypot(dx, dy) }
}
