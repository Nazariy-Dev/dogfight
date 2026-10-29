export const lerp = (a, b, t) => a + (b - a) * t

/**
 * Інтерполяція кута найкоротшим шляхом. Наївний lerp між 3,1 і -3,1 рад
 * крутив би ніс майже на повний оберт замість 0,08 рад.
 */
export function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

export function interpolateShip(prev, cur, alpha, w, h) {
  return {
    x: ((lerp(prev.x, cur.x, alpha) % w) + w) % w,
    y: ((lerp(prev.y, cur.y, alpha) % h) + h) % h,
    angle: lerpAngle(prev.angle, cur.angle, alpha),
    thrusting: cur.thrusting,
  }
}
