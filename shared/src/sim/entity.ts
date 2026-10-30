import { Vector2 } from './vector.ts'
import { integrate } from './ship.ts'
import { makeHoming, type Homing } from './behaviors.ts'
import { asEntityId, NO_CONTROLS, type Controls, type EntityId } from '../types.ts'
import type { World } from './world.ts'
import { Pool } from './pool.ts'

export type EntityKind = 'ship' | 'bullet' | 'asteroid' | 'explosion' | 'pickup'

export interface EntityInit {
  x?: number
  y?: number
  vx?: number
  vy?: number
  angle?: number
  radius?: number
}

/**
 * Базова сутність. Ієрархія — один рівень. Конкретний тип звужується за полем kind
 * (discriminated union Entity нижче).
 */
export abstract class EntityBase {
  static #nextId = 1
  readonly #id: EntityId = asEntityId(EntityBase.#nextId++)
  abstract readonly kind: EntityKind
  pos: Vector2
  vel: Vector2
  angle: number
  radius: number
  alive = true
  readonly prev: { x: number; y: number; angle: number }
  world: World | null = null
  homing?: Homing

  constructor({ x = 0, y = 0, vx = 0, vy = 0, angle = 0, radius = 10 }: EntityInit) {
    this.pos = new Vector2(x, y)
    this.vel = new Vector2(vx, vy)
    this.angle = angle
    this.radius = radius
    this.prev = { x, y, angle }
  }
  get id(): EntityId {
    return this.#id
  }
  savePrevious(): void {
    this.prev.x = this.pos.x
    this.prev.y = this.pos.y
    this.prev.angle = this.angle
  }
  update(dt: number): void {
    this.pos = this.pos.add(this.vel.scale(dt))
  }
}

export const SHIP_HP = 100
export const FIRE_COOLDOWN = 0.18
export const BULLET_SPEED = 620
export const RESPAWN_DELAY = 2

export class Ship extends EntityBase {
  readonly kind = 'ship'
  #hp = SHIP_HP
  owner: string
  color: string
  controls: Controls = NO_CONTROLS
  cooldown = 0
  thrusting = false
  shield = 0
  rapid = 0
  homingShots = 0
  score = 0
  respawnIn = 0

  constructor({
    owner = 'local',
    color = '#7fd1ff',
    ...rest
  }: EntityInit & { owner?: string; color?: string } = {}) {
    super({ radius: 14, angle: -Math.PI / 2, ...rest })
    this.owner = owner
    this.color = color
  }
  get hp(): number {
    return this.#hp
  }
  get dead(): boolean {
    return this.respawnIn > 0
  }
  damage(amount: number): boolean {
    if (this.dead || this.shield > 0) return false
    this.#hp = Math.max(0, this.#hp - amount)
    if (this.#hp === 0) {
      this.respawnIn = RESPAWN_DELAY
      return true
    }
    return false
  }
  respawn(x: number, y: number): void {
    this.#hp = SHIP_HP
    this.respawnIn = 0
    this.pos = new Vector2(x, y)
    this.vel = new Vector2(0, 0)
    this.angle = -Math.PI / 2
    this.shield = 1.5
    this.savePrevious()
  }
  override update(dt: number): void {
    if (this.dead) return
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
    this.thrusting = this.controls.thrust
    this.cooldown = Math.max(0, this.cooldown - dt)
    this.shield = Math.max(0, this.shield - dt)
    this.rapid = Math.max(0, this.rapid - dt)
    this.homingShots = Math.max(0, this.homingShots - dt)
  }
  fire(): Bullet | null {
    if (this.dead || this.cooldown > 0) return null
    this.cooldown = this.rapid > 0 ? FIRE_COOLDOWN / 3 : FIRE_COOLDOWN
    const dir = Vector2.fromAngle(this.angle)
    const nose = this.pos.add(dir.scale(this.radius + 4))
    const vel = this.vel.add(dir.scale(BULLET_SPEED))
    const b = new Bullet({ x: nose.x, y: nose.y, vx: vel.x, vy: vel.y, owner: this.id })
    if (this.homingShots > 0) b.homing = makeHoming({ targetKind: 'ship', turnRate: 3 })
    return this.world ? this.world.spawn(b) : b
  }
}

export class Bullet extends EntityBase {
  readonly kind = 'bullet'
  owner: EntityId | -1
  ttl: number
  damage: number
  constructor({
    owner,
    ttl = 1.1,
    damage = 25,
    ...rest
  }: EntityInit & { owner: EntityId | -1; ttl?: number; damage?: number }) {
    super({ radius: 3, ...rest })
    this.owner = owner
    this.ttl = ttl
    this.damage = damage
  }
  override update(dt: number): void {
    super.update(dt)
    this.ttl -= dt
    if (this.ttl <= 0) this.alive = false
  }
}

export type AsteroidSize = 1 | 2 | 3

export class Asteroid extends EntityBase {
  readonly kind = 'asteroid'
  size: AsteroidSize
  hp: number
  spin = 0
  constructor({ size = 3, ...rest }: EntityInit & { size?: AsteroidSize }) {
    super({ radius: 10 + size * 9, ...rest })
    this.size = size
    this.hp = size * 25
  }
  override update(dt: number): void {
    super.update(dt)
    this.angle += this.spin * dt
  }
}

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
}

/** Спільний пул частинок вибухів (Lab 7): частинки перевикористовуються, а не створюються щоразу. */
export const particlePool = new Pool<Particle>(() => ({ x: 0, y: 0, vx: 0, vy: 0 }), 512)

export class Explosion extends EntityBase {
  readonly kind = 'explosion'
  ttl: number
  readonly life: number
  color: string
  particles: Particle[]
  constructor({
    particles,
    ttl = 0.8,
    color = '#ffb347',
    ...rest
  }: EntityInit & { particles: Particle[]; ttl?: number; color?: string }) {
    super({ radius: 0, ...rest })
    this.ttl = ttl
    this.life = ttl
    this.color = color
    this.particles = particles
  }
  override update(dt: number): void {
    for (const p of this.particles) {
      p.x += p.vx * dt
      p.y += p.vy * dt
    }
    this.ttl -= dt
    if (this.ttl <= 0) {
      this.alive = false
      for (const p of this.particles) particlePool.release(p)
      this.particles = []
    }
  }
}

export type PickupEffect = 'shield' | 'rapid' | 'homing'
export const PICKUP_EFFECTS_LIST: readonly PickupEffect[] = ['shield', 'rapid', 'homing']

export class Pickup extends EntityBase {
  readonly kind = 'pickup'
  readonly pickup: { readonly effect: PickupEffect; readonly duration: number }
  constructor({
    effect = 'shield',
    duration = 6,
    ...rest
  }: EntityInit & { effect?: PickupEffect; duration?: number }) {
    super({ radius: 11, ...rest })
    this.pickup = { effect, duration }
  }
  override update(dt: number): void {
    this.angle += 1.5 * dt
  }
}

/** Discriminated union: switch (e.kind) звужує тип до конкретного класу. */
export type Entity = Ship | Bullet | Asteroid | Explosion | Pickup
export type EntityOfKind<K extends EntityKind> = Extract<Entity, { kind: K }>
