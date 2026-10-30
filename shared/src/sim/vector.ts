/**
 * Vector2 — незмінний 2D-вектор. Поля readonly, усі методи повертають новий вектор.
 */
export class Vector2 {
  readonly x: number
  readonly y: number
  constructor(x = 0, y = 0) {
    this.x = x
    this.y = y
  }
  static fromAngle(angle: number, length = 1): Vector2 {
    return new Vector2(Math.cos(angle) * length, Math.sin(angle) * length)
  }
  add(v: Vector2): Vector2 {
    return new Vector2(this.x + v.x, this.y + v.y)
  }
  sub(v: Vector2): Vector2 {
    return new Vector2(this.x - v.x, this.y - v.y)
  }
  scale(k: number): Vector2 {
    return new Vector2(this.x * k, this.y * k)
  }
  dot(v: Vector2): number {
    return this.x * v.x + this.y * v.y
  }
  length(): number {
    return Math.hypot(this.x, this.y)
  }
  normalize(): Vector2 {
    const l = this.length()
    return l === 0 ? new Vector2(0, 0) : new Vector2(this.x / l, this.y / l)
  }
  rotate(a: number): Vector2 {
    const c = Math.cos(a)
    const s = Math.sin(a)
    return new Vector2(this.x * c - this.y * s, this.x * s + this.y * c)
  }
}
