import { Vector2 } from './vector.js'
import { integrate } from './ship.js'
import { makeHoming } from './behaviors.js'

/**
 * Базова сутність. Ієрархія — лише один рівень: X extends Entity.
 * Різну поведінку (самонаведення, підбирання) додаємо композицією —
 * полями-компонентами, які обробляють системи у world.js.
 */
export class Entity {
  static #nextId = 1
  #id = Entity.#nextId++

  constructor({ kind, x = 0, y = 0, vx = 0, vy = 0, angle = 0, radius = 10 }) {
    this.kind = kind
    this.pos = new Vector2(x, y)
    this.vel = new Vector2(vx, vy)
    this.angle = angle
    this.radius = radius
    this.alive = true
    this.prev = { x, y, angle } // стан попереднього кроку для інтерполяції
    this.world = null // встановлює World.spawn
  }
  get id() {
    return this.#id
  }
  savePrevious() {
    this.prev.x = this.pos.x
    this.prev.y = this.pos.y
    this.prev.angle = this.angle
  }
  update(dt) {
    this.pos = this.pos.add(this.vel.scale(dt))
  }
}

export const SHIP_HP = 100
export const FIRE_COOLDOWN = 0.18
export const BULLET_SPEED = 620
export const RESPAWN_DELAY = 2

export class Ship extends Entity {
  #hp = SHIP_HP

  constructor({ owner = 'local', color = '#7fd1ff', ...rest } = {}) {
    super({ kind: 'ship', radius: 14, angle: -Math.PI / 2, ...rest })
    this.owner = owner
    this.color = color
    this.controls = { left: false, right: false, thrust: false, fire: false }
    this.cooldown = 0
    this.thrusting = false
    this.shield = 0 // секунди дії щита (від pickup)
    this.rapid = 0 // секунди швидкої стрільби (від pickup)
    this.homingShots = 0 // секунди самонавідних куль (від pickup)
    this.score = 0
    this.respawnIn = 0 // > 0 — корабель знищено, чекає респауну
  }
  get hp() {
    return this.#hp
  }
  get dead() {
    return this.respawnIn > 0
  }
  /** Отримати шкоду; повертає true, якщо корабель знищено цим ударом. */
  damage(amount) {
    if (this.dead || this.shield > 0) return false
    this.#hp = Math.max(0, this.#hp - amount)
    if (this.#hp === 0) {
      this.respawnIn = RESPAWN_DELAY
      return true
    }
    return false
  }
  respawn(x, y) {
    this.#hp = SHIP_HP
    this.respawnIn = 0
    this.pos = new Vector2(x, y)
    this.vel = new Vector2(0, 0)
    this.angle = -Math.PI / 2
    this.shield = 1.5 // коротка невразливість після появи
    this.savePrevious()
  }
  update(dt) {
    if (this.dead) return
    // Фізика з Lab 1: integrate працює з плоским об'єктом {x,y,vx,vy,angle}
    const s = {
      x: this.pos.x,
      y: this.pos.y,
      vx: this.vel.x,
      vy: this.vel.y,
      angle: this.angle,
    }
    integrate(s, this.controls, dt)
    this.pos = new Vector2(s.x, s.y)
    this.vel = new Vector2(s.vx, s.vy)
    this.angle = s.angle
    this.thrusting = !!this.controls.thrust
    this.cooldown = Math.max(0, this.cooldown - dt)
    this.shield = Math.max(0, this.shield - dt)
    this.rapid = Math.max(0, this.rapid - dt)
    this.homingShots = Math.max(0, this.homingShots - dt)
  }
  /** Постріл з носа корабля зі швидкістю корабля + швидкість кулі. */
  fire() {
    if (this.dead || this.cooldown > 0) return null
    this.cooldown = this.rapid > 0 ? FIRE_COOLDOWN / 3 : FIRE_COOLDOWN
    const dir = Vector2.fromAngle(this.angle)
    const nose = this.pos.add(dir.scale(this.radius + 4))
    const vel = this.vel.add(dir.scale(BULLET_SPEED))
    const b = new Bullet({ x: nose.x, y: nose.y, vx: vel.x, vy: vel.y, owner: this.id })
    // та сама поведінка, що й в астероїда, — просто додаємо компонент
    if (this.homingShots > 0) b.homing = makeHoming({ targetKind: 'ship', turnRate: 3 })
    return this.world ? this.world.spawn(b) : b
  }
}

export class Bullet extends Entity {
  constructor({ owner, ttl = 1.1, damage = 25, ...rest }) {
    super({ kind: 'bullet', radius: 3, ...rest })
    this.owner = owner
    this.ttl = ttl
    this.damage = damage
  }
  update(dt) {
    super.update(dt)
    this.ttl -= dt
    if (this.ttl <= 0) this.alive = false
  }
}

export class Asteroid extends Entity {
  constructor({ size = 3, ...rest }) {
    super({ kind: 'asteroid', radius: 10 + size * 9, ...rest })
    this.size = size // 3 — великий, 1 — дрібний
    this.hp = size * 25
    this.spin = 0
  }
  update(dt) {
    super.update(dt)
    this.angle += this.spin * dt
  }
}

/** Вибух — набір короткоживучих частинок. */
export class Explosion extends Entity {
  constructor({ particles, ttl = 0.8, color = '#ffb347', ...rest }) {
    super({ kind: 'explosion', radius: 0, ...rest })
    this.ttl = ttl
    this.life = ttl
    this.color = color
    this.particles = particles // [{x, y, vx, vy}]
  }
  update(dt) {
    for (const p of this.particles) {
      p.x += p.vx * dt
      p.y += p.vy * dt
    }
    this.ttl -= dt
    if (this.ttl <= 0) this.alive = false
  }
}

/** Pickup стоїть на місці і бере участь у колізіях, але кораблем не є. */
export class Pickup extends Entity {
  constructor({ effect = 'shield', duration = 6, ...rest }) {
    super({ kind: 'pickup', radius: 11, ...rest })
    // Компонент «можна підібрати» — дані, а не підклас
    this.pickup = { effect, duration }
  }
  update(dt) {
    this.angle += 1.5 * dt
  }
}
