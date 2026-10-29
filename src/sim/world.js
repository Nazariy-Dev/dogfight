import { Vector2 } from './vector.js'
import { Asteroid, Explosion, Pickup } from './entity.js'
import { naivePairs } from './collision.js'
import { homingSystem, makeHoming, PICKUP_EFFECTS } from './behaviors.js'
import { mod } from './arena.js'
import { createRng } from './rng.js'

export const ARENA = { w: 1280, h: 720 }

/**
 * World — сховище сутностей поверх Map<id, Entity>.
 * despawn лише позначає сутність мертвою; фізично видаляємо в sweep()
 * наприкінці кроку, щоб не змінювати Map під час обходу.
 * Події (постріл, влучання, вибух) йдуть через колбек emit — симуляція
 * не знає про звук, HUD чи DOM.
 */
export class World {
  #entities = new Map()

  constructor({
    w = ARENA.w,
    h = ARENA.h,
    seed = 1,
    emit = () => {},
    collide = naivePairs,
  } = {}) {
    this.w = w
    this.h = h
    this.rng = createRng(seed)
    this.emit = emit
    this.collide = collide // система колізій — підмінна функція
    this.time = 0
    this.tick = 0
    this.pickupTimer = 5
  }

  spawn(e) {
    e.world = this
    this.#entities.set(e.id, e)
    return e
  }
  despawn(id) {
    const e = this.#entities.get(id)
    if (e) e.alive = false
  }
  get(id) {
    return this.#entities.get(id)
  }
  get size() {
    return this.#entities.size
  }
  *[Symbol.iterator]() {
    yield* this.#entities.values()
  }
  *ofKind(kind) {
    for (const e of this) if (e.kind === kind) yield e
  }
  sweep() {
    for (const [id, e] of this.#entities) if (!e.alive) this.#entities.delete(id)
  }

  /** Один крок симуляції фіксованої тривалості dt. */
  step(dt) {
    this.tick += 1
    this.time += dt
    for (const e of this) e.savePrevious()

    // 1) рух і власна логіка сутностей
    for (const e of this) e.update(dt)
    // 2) постріли (рішення з controls, щоб симуляція не залежала від DOM)
    for (const s of this.ofKind('ship')) {
      if (s.controls.fire && !s.dead) {
        const b = s.fire()
        if (b) this.emit('fired', { ship: s.id, bullet: b.id })
      }
    }
    // 3) поведінки-компоненти
    homingSystem(this, dt)
    // 4) загортання країв
    for (const e of this) this.#wrap(e)
    // 5) колізії
    for (const [a, b] of this.collide([...this])) this.#resolve(a, b)
    // 6) таймери: респаун, поява pickup
    this.#timers(dt)
    // 7) прибирання мертвих
    this.sweep()
  }

  #wrap(e) {
    const x = mod(e.pos.x, this.w)
    const y = mod(e.pos.y, this.h)
    if (x !== e.pos.x || y !== e.pos.y) {
      // зсуваємо prev разом із позицією, щоб інтерполяція не тягнула через арену
      e.prev.x += x - e.pos.x
      e.prev.y += y - e.pos.y
      e.pos = new Vector2(x, y)
    }
  }

  #resolve(a, b) {
    const pair = (k1, k2) =>
      a.kind === k1 && b.kind === k2
        ? [a, b]
        : b.kind === k1 && a.kind === k2
          ? [b, a]
          : null
    let p
    if ((p = pair('bullet', 'ship'))) {
      const [bullet, ship] = p
      if (bullet.owner === ship.id) return // власна куля не б'є
      bullet.alive = false
      const killed = ship.damage(bullet.damage)
      this.emit('hit', { target: ship.id, by: bullet.owner, hp: ship.hp })
      if (killed) {
        const shooter = this.get(bullet.owner)
        if (shooter) shooter.score += 1
        this.explode(ship.pos, ship.color)
      }
    } else if ((p = pair('bullet', 'asteroid'))) {
      const [bullet, rock] = p
      if (!rock.alive) return
      bullet.alive = false
      rock.hp -= bullet.damage
      this.emit('hit', { target: rock.id, by: bullet.owner })
      if (rock.hp <= 0) this.#breakAsteroid(rock, bullet.owner)
    } else if ((p = pair('ship', 'asteroid'))) {
      const [ship, rock] = p
      if (ship.damage(40)) this.explode(ship.pos, ship.color)
      // відштовхування корабля
      const n = ship.pos.sub(rock.pos).normalize()
      ship.vel = n.scale(Math.max(ship.vel.length(), 120))
    } else if ((p = pair('ship', 'pickup'))) {
      const [ship, pick] = p
      if (!pick.alive) return
      pick.alive = false
      PICKUP_EFFECTS[pick.pickup.effect]?.(ship, pick.pickup.duration)
      this.emit('picked', { ship: ship.id, effect: pick.pickup.effect })
    }
  }

  #breakAsteroid(rock, by) {
    rock.alive = false
    const shooter = this.get(by)
    if (shooter && shooter.kind === 'ship') shooter.score += 1
    this.explode(rock.pos, '#c9b28f')
    if (rock.size > 1) {
      for (let i = 0; i < 2; i++) {
        const v = Vector2.fromAngle(
          this.rng.range(0, Math.PI * 2),
          this.rng.range(40, 90),
        )
        const child = this.spawn(
          new Asteroid({
            size: rock.size - 1,
            x: rock.pos.x,
            y: rock.pos.y,
            vx: v.x,
            vy: v.y,
          }),
        )
        child.spin = this.rng.range(-1, 1)
      }
    }
  }

  explode(pos, color) {
    const particles = []
    for (let i = 0; i < 24; i++) {
      const v = Vector2.fromAngle(this.rng.range(0, Math.PI * 2), this.rng.range(40, 220))
      particles.push({ x: 0, y: 0, vx: v.x, vy: v.y })
    }
    const e = this.spawn(new Explosion({ x: pos.x, y: pos.y, particles, color }))
    this.emit('exploded', { at: { x: pos.x, y: pos.y }, id: e.id })
    return e
  }

  /** Випадкова точка, де поруч немає кораблів і астероїдів. */
  safeSpot(minDist = 140) {
    for (let tries = 0; tries < 50; tries++) {
      const p = new Vector2(
        this.rng.range(40, this.w - 40),
        this.rng.range(40, this.h - 40),
      )
      let ok = true
      for (const e of this) {
        if ((e.kind === 'ship' || e.kind === 'asteroid') && !e.dead && e.alive) {
          if (e.pos.sub(p).length() < minDist + e.radius) {
            ok = false
            break
          }
        }
      }
      if (ok) return p
    }
    return new Vector2(this.w / 2, this.h / 2)
  }

  #timers(dt) {
    for (const s of this.ofKind('ship')) {
      if (s.respawnIn > 0) {
        s.respawnIn -= dt
        if (s.respawnIn <= 0) {
          const p = this.safeSpot()
          s.respawn(p.x, p.y)
          this.emit('respawned', { ship: s.id })
        }
      }
    }
    this.pickupTimer -= dt
    if (this.pickupTimer <= 0) {
      this.pickupTimer = 8
      const count = [...this.ofKind('pickup')].length
      if (count < 2) {
        const p = this.safeSpot(60)
        const effect = ['shield', 'rapid', 'homing'][this.rng.int(0, 2)]
        this.spawn(new Pickup({ x: p.x, y: p.y, effect }))
      }
    }
  }

  /** Початкове наповнення арени. */
  populate({ asteroids = 5, homingAsteroids = 1 } = {}) {
    for (let i = 0; i < asteroids + homingAsteroids; i++) {
      const p = this.safeSpot(160)
      const v = Vector2.fromAngle(this.rng.range(0, Math.PI * 2), this.rng.range(20, 60))
      const a = this.spawn(new Asteroid({ size: 3, x: p.x, y: p.y, vx: v.x, vy: v.y }))
      a.spin = this.rng.range(-0.8, 0.8)
      if (i >= asteroids) a.homing = makeHoming({ targetKind: 'ship', turnRate: 0.6 })
    }
  }
}
