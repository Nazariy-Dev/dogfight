import { integrate, type ShipState } from '../sim/ship.ts'
import { mod } from '../sim/arena.ts'
import type { Input, Seq } from '../types.ts'

export function predictStep<S extends ShipState>(
  state: S,
  input: Input,
  dt: number,
  w: number,
  h: number,
): S {
  integrate(state, input, dt)
  state.x = mod(state.x, w)
  state.y = mod(state.y, h)
  return state
}

/** Звірка: стан сервера + повторне програвання непідтверджених input. Чиста функція. */
export function reconcile(
  server: Readonly<ShipState>,
  ackSeq: Seq,
  pending: readonly Input[],
  dt: number,
  w: number,
  h: number,
): { state: ShipState; pending: Input[] } {
  const rest = pending.filter((p) => p.seq > ackSeq)
  const s: ShipState = {
    x: server.x,
    y: server.y,
    vx: server.vx,
    vy: server.vy,
    angle: server.angle,
  }
  for (const inp of rest) predictStep(s, inp, dt, w, h)
  return { state: s, pending: rest }
}

export interface XY {
  readonly x: number
  readonly y: number
}

export function wrappedDelta(
  a: XY,
  b: XY,
  w: number,
  h: number,
): { dx: number; dy: number; d: number } {
  let dx = b.x - a.x
  let dy = b.y - a.y
  if (dx > w / 2) dx -= w
  if (dx < -w / 2) dx += w
  if (dy > h / 2) dy -= h
  if (dy < -h / 2) dy += h
  return { dx, dy, d: Math.hypot(dx, dy) }
}
