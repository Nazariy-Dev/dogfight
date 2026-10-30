export interface Point {
  x: number
  y: number
}

/** Ділення за модулем, що завжди дає значення в [0, m). */
export function mod(a: number, m: number): number {
  return ((a % m) + m) % m
}

export function wrap<T extends Point>(obj: T, w: number, h: number): T {
  obj.x = mod(obj.x, w)
  obj.y = mod(obj.y, h)
  return obj
}

/** Зсунути prev на ширину/висоту арени, щоб інтерполяція не тягнула корабель через увесь екран. */
export function unwrapPrevious(prev: Point, cur: Point, w: number, h: number): void {
  if (cur.x - prev.x > w / 2) prev.x += w
  else if (prev.x - cur.x > w / 2) prev.x -= w
  if (cur.y - prev.y > h / 2) prev.y += h
  else if (prev.y - cur.y > h / 2) prev.y -= h
}
