export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Інтерполяція кута найкоротшим шляхом через ±π. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

export interface Pose {
  x: number
  y: number
  angle: number
  thrusting?: boolean
}

export function interpolateShip(
  prev: Pose,
  cur: Pose,
  alpha: number,
  w: number,
  h: number,
): Pose {
  return {
    x: ((lerp(prev.x, cur.x, alpha) % w) + w) % w,
    y: ((lerp(prev.y, cur.y, alpha) % h) + h) % h,
    angle: lerpAngle(prev.angle, cur.angle, alpha),
    thrusting: cur.thrusting ?? false,
  }
}
