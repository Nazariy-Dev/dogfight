/**
 * Vector2 — незмінний 2D-вектор. Усі методи повертають НОВИЙ вектор,
 * аргументи й this не змінюються (a.add(b) не мутує a).
 */
export class Vector2 {
  constructor(x = 0, y = 0) {
    this.x = x
    this.y = y
  }
  static fromAngle(angle, length = 1) {
    return new Vector2(Math.cos(angle) * length, Math.sin(angle) * length)
  }
  add(v) {
    return new Vector2(this.x + v.x, this.y + v.y)
  }
  sub(v) {
    return new Vector2(this.x - v.x, this.y - v.y)
  }
  scale(k) {
    return new Vector2(this.x * k, this.y * k)
  }
  dot(v) {
    return this.x * v.x + this.y * v.y
  }
  length() {
    return Math.hypot(this.x, this.y)
  }
  normalize() {
    const l = this.length()
    return l === 0 ? new Vector2(0, 0) : new Vector2(this.x / l, this.y / l)
  }
  rotate(a) {
    const c = Math.cos(a)
    const s = Math.sin(a)
    return new Vector2(this.x * c - this.y * s, this.x * s + this.y * c)
  }
  clone() {
    return new Vector2(this.x, this.y)
  }
}
