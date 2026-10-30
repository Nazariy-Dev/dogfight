import type { Entity } from './entity.ts'

export type Pair = readonly [Entity, Entity]
/** Система колізій — підмінна функція (наївна O(n²) або просторовий хеш). */
export type CollisionSystem = (entities: readonly Entity[]) => Pair[]

export function circlesOverlap(a: Entity, b: Entity): boolean {
  const dx = a.pos.x - b.pos.x
  const dy = a.pos.y - b.pos.y
  const r = a.radius + b.radius
  return dx * dx + dy * dy < r * r
}

export const collidable = (e: Entity): boolean =>
  e.alive && e.radius > 0 && !(e.kind === 'ship' && e.dead)

export const naivePairs: CollisionSystem = (entities) => {
  const list = entities.filter(collidable)
  const pairs: Pair[] = []
  for (let i = 0; i < list.length; i++) {
    const a = list[i]!
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j]!
      if (circlesOverlap(a, b)) pairs.push([a, b])
    }
  }
  return pairs
}
