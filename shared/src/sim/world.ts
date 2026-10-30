import { Vector2 } from './vector.ts'
import {
  Asteroid,
  Explosion,
  Pickup,
  PICKUP_EFFECTS_LIST,
  type AsteroidSize,
  type Entity,
  type EntityKind,
  type EntityOfKind,
  type Particle,
} from './entity.ts'
import { naivePairs, type CollisionSystem } from './collision.ts'
import { homingSystem, makeHoming, PICKUP_EFFECTS } from './behaviors.ts'
import { mod } from './arena.ts'
import { createRng, type Rng } from './rng.ts'
import { asTick, type EntityId, type Tick } from '../types.ts'

export const ARENA = { w: 1280, h: 720 } as const

/** Події світу: назва → дані. Слухачі (звук, HUD, лог) отримують типізовані дані. */
export interface WorldEvents {
  fired: { ship: EntityId; bullet: EntityId }
  hit: { target: EntityId; by: EntityId | -1; hp?: number }
  exploded: { at: { x: number; y: number }; id: EntityId }
  picked: { ship: EntityId; effect: string }
  respawned: { ship: EntityId }
}
export type Emit = <K extends keyof WorldEvents>(type: K, detail: WorldEvents[K]) => void

export interface WorldOptions {
  w?: number
  h?: number
  seed?: number
  emit?: Emit
  collide?: CollisionSystem
}

/**
 * World — сховище сутностей поверх Map<EntityId, Entity>.
 * despawn лише позначає сутність мертвою; фізично видаляємо в sweep() наприкінці кроку.
 * Симуляція не знає про звук, HUD чи DOM — лише викликає emit.
 */
export class World {
  readonly #entities = new Map<EntityId, Entity>()
  readonly w: number
  readonly h: number
  readonly rng: Rng
  emit: Emit
  collide: CollisionSystem
  time = 0
  tick: Tick = asTick(0)
  pickupTimer = 5

  constructor({
    w = ARENA.w,
    h = ARENA.h,
    seed = 1,
    emit = () => {},
    collide = naivePairs,
  }: WorldOptions = {}) {
    this.w = w
    this.h = h
    this.rng = createRng(seed)
    this.emit = emit
    this.collide = collide
  }

  spawn<E extends Entity>(e: E): E {
    e.world = this
    this.#entities.set(e.id, e)
    return e
  }
  despawn(id: EntityId): void {
    const e = this.#entities.get(id)
    if (e) e.alive = false
  }
  get(id: EntityId): Entity | undefined {
    return this.#entities.get(id)
  }
  get size(): number {
    return this.#entities.size
  }
  *[Symbol.iterator](): IterableIterator<Entity> {
    yield* this.#entities.values()
  }
  *ofKind<K extends EntityKind>(kind: K): Generator<EntityOfKind<K>> {
    for (const e of this) if (isKind(e, kind)) yield e
  }
  sweep(): void {
    for (const [id, e] of this.#entities) if (!e.alive) this.#entities.delete(id)
  }

  /** Один крок симуляції фіксованої тривалості dt. */
  step(dt: number): void {
    this.tick = asTick(this.tick + 1)
    this.time += dt
    for (const e of this) e.savePrevious()
    for (const e of this) e.update(dt)
    for (const s of this.ofKind('ship')) {
      if (s.controls.fire && !s.dead) {
        const b = s.fire()
        if (b) this.emit('fired', { ship: s.id, bullet: b.id })
      }
    }
    homingSystem(this, dt)
    for (const e of this) this.#wrap(e)
    for (const [a, b] of this.collide([...this])) this.#resolve(a, b)
    this.#timers(dt)
    this.sweep()
  }

  #wrap(e: Entity): void {
    const x = mod(e.pos.x, this.w)
    const y = mod(e.pos.y, this.h)
    if (x !== e.pos.x || y !== e.pos.y) {
      e.prev.x += x - e.pos.x
      e.prev.y += y - e.pos.y
      e.pos = new Vector2(x, y)
    }
  }

  #resolve(a: Entity, b: Entity): void {
    const bs = pairOf(a, b, 'bullet', 'ship')
    const ba = pairOf(a, b, 'bullet', 'asteroid')
    const sa = pairOf(a, b, 'ship', 'asteroid')
    const sp = pairOf(a, b, 'ship', 'pickup')
    if (bs) {
      const [bullet, ship] = bs
      if (bullet.owner === ship.id) return
      bullet.alive = false
      const killed = ship.damage(bullet.damage)
      this.emit('hit', { target: ship.id, by: bullet.owner, hp: ship.hp })
      if (killed) {
        const shooter = bullet.owner === -1 ? undefined : this.get(bullet.owner)
        if (shooter?.kind === 'ship') shooter.score += 1
        this.explode(ship.pos, ship.color)
      }
    } else if (ba) {
      const [bullet, rock] = ba
      if (!rock.alive) return
      bullet.alive = false
      rock.hp -= bullet.damage
      this.emit('hit', { target: rock.id, by: bullet.owner })
      if (rock.hp <= 0) this.#breakAsteroid(rock, bullet.owner)
    } else if (sa) {
      const [ship, rock] = sa
      if (ship.damage(40)) this.explode(ship.pos, ship.color)
      const n = ship.pos.sub(rock.pos).normalize()
      ship.vel = n.scale(Math.max(ship.vel.length(), 120))
    } else if (sp) {
      const [ship, pick] = sp
      if (!pick.alive) return
      pick.alive = false
      PICKUP_EFFECTS[pick.pickup.effect](ship, pick.pickup.duration)
      this.emit('picked', { ship: ship.id, effect: pick.pickup.effect })
    }
  }

  #breakAsteroid(rock: Asteroid, by: EntityId | -1): void {
    rock.alive = false
    const shooter = by === -1 ? undefined : this.get(by)
    if (shooter?.kind === 'ship') shooter.score += 1
    this.explode(rock.pos, '#c9b28f')
    if (rock.size > 1) {
      const size: AsteroidSize = rock.size === 3 ? 2 : 1
      for (let i = 0; i < 2; i++) {
        const v = Vector2.fromAngle(
          this.rng.range(0, Math.PI * 2),
          this.rng.range(40, 90),
        )
        const child = this.spawn(
          new Asteroid({ size, x: rock.pos.x, y: rock.pos.y, vx: v.x, vy: v.y }),
        )
        child.spin = this.rng.range(-1, 1)
      }
    }
  }

  explode(pos: Vector2, color: string): Explosion {
    const particles: Particle[] = []
    for (let i = 0; i < 24; i++) {
      const v = Vector2.fromAngle(this.rng.range(0, Math.PI * 2), this.rng.range(40, 220))
      particles.push({ x: 0, y: 0, vx: v.x, vy: v.y })
    }
    const e = this.spawn(new Explosion({ x: pos.x, y: pos.y, particles, color }))
    this.emit('exploded', { at: { x: pos.x, y: pos.y }, id: e.id })
    return e
  }

  /** Випадкова точка, де поруч немає кораблів і астероїдів. */
  safeSpot(minDist = 140): Vector2 {
    for (let tries = 0; tries < 50; tries++) {
      const p = new Vector2(
        this.rng.range(40, this.w - 40),
        this.rng.range(40, this.h - 40),
      )
      let ok = true
      for (const e of this) {
        const blocking = (e.kind === 'ship' && !e.dead) || e.kind === 'asteroid'
        if (blocking && e.alive && e.pos.sub(p).length() < minDist + e.radius) {
          ok = false
          break
        }
      }
      if (ok) return p
    }
    return new Vector2(this.w / 2, this.h / 2)
  }

  #timers(dt: number): void {
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
      if ([...this.ofKind('pickup')].length < 2) {
        const p = this.safeSpot(60)
        const effect = PICKUP_EFFECTS_LIST[this.rng.int(0, 2)] ?? 'shield'
        this.spawn(new Pickup({ x: p.x, y: p.y, effect }))
      }
    }
  }

  populate({
    asteroids = 5,
    homingAsteroids = 1,
  }: { asteroids?: number; homingAsteroids?: number } = {}): void {
    for (let i = 0; i < asteroids + homingAsteroids; i++) {
      const p = this.safeSpot(160)
      const v = Vector2.fromAngle(this.rng.range(0, Math.PI * 2), this.rng.range(20, 60))
      const a = this.spawn(new Asteroid({ size: 3, x: p.x, y: p.y, vx: v.x, vy: v.y }))
      a.spin = this.rng.range(-0.8, 0.8)
      if (i >= asteroids) a.homing = makeHoming({ targetKind: 'ship', turnRate: 0.6 })
    }
  }
}

/** Type guard: звужує Entity до класу заданого виду. */
export function isKind<K extends EntityKind>(e: Entity, kind: K): e is EntityOfKind<K> {
  return e.kind === kind
}

function pairOf<A extends EntityKind, B extends EntityKind>(
  a: Entity,
  b: Entity,
  k1: A,
  k2: B,
): [EntityOfKind<A>, EntityOfKind<B>] | null {
  if (isKind(a, k1) && isKind(b, k2)) return [a, b]
  if (isKind(b, k1) && isKind(a, k2)) return [b, a]
  return null
}
